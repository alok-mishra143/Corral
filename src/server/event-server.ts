import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventStore } from "../events/store.js";
import {
  loadRules,
  newRuleId,
  parseRule,
  saveRules,
} from "../policy/rules.js";
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
  type CorralSettings,
} from "../policy/settings.js";
import { getDashboardHtml } from "./dashboard.js";
import { scanAgents } from "../scanner/process-scanner.js";

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

const UI_TOKEN = randomBytes(24).toString("hex");

const AGENTS_CACHE_MS = 10_000;
let agentsCache: { at: number; value: Awaited<ReturnType<typeof scanAgents>> } | null = null;

async function cachedAgents(): Promise<Awaited<ReturnType<typeof scanAgents>>> {
  if (agentsCache && Date.now() - agentsCache.at < AGENTS_CACHE_MS) return agentsCache.value;
  const value = await scanAgents().catch(() => []);
  agentsCache = { at: Date.now(), value };
  return value;
}

export const UI_TOKEN_HEADER = "x-corral-ui";

function tokenMatches(req: IncomingMessage): boolean {
  const raw = req.headers[UI_TOKEN_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length !== UI_TOKEN.length) return false;
  try {
    return timingSafeEqual(Buffer.from(value), Buffer.from(UI_TOKEN));
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  let text: string;
  try {
    text = await readBody(req);
  } catch {
    return { ok: false, status: 413, error: "payload too large" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "malformed JSON" };
  }
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
  });
  res.end(html);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface EventServerOptions {
  port?: number;
  host?: string;
  store?: EventStore;
}

export interface EventServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

export function createEventServer(options: EventServerOptions = {}): Promise<EventServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const store = options.store ?? new EventStore();

  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error(`refusing to bind event server to non-loopback host: ${host}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
        sendHtml(res, await getDashboardHtml(UI_TOKEN));
        return;
      }
      if (url.pathname === "/api/settings" && (req.method === "GET" || req.method === "PUT")) {
        if (req.method === "PUT" && !tokenMatches(req)) {
          sendJson(res, 403, { ok: false, error: "dashboard UI token required" });
          return;
        }
        if (req.method === "GET") {
          sendJson(res, 200, { settings: await loadSettings() });
          return;
        }
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { ok: false, error: body.error });
          return;
        }
        const value = (typeof body.value === "object" && body.value !== null ? body.value : {}) as Record<string, unknown>;
        const saved: CorralSettings = await saveSettings(normalizeSettings(value));
        sendJson(res, 200, { ok: true, settings: saved });
        return;
      }
      if (url.pathname === "/api/agents" && req.method === "GET") {
        sendJson(res, 200, { agents: await cachedAgents() });
        return;
      }
      if (url.pathname.startsWith("/api/agents/") && url.pathname.endsWith("/kill") && req.method === "POST") {
        if (!tokenMatches(req)) {
          sendJson(res, 403, { ok: false, error: "dashboard UI token required" });
          return;
        }
        const pidRaw = url.pathname.slice("/api/agents/".length, -"/kill".length);
        const pid = Number(pidRaw);
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
          sendJson(res, 400, { ok: false, error: "invalid pid" });
          return;
        }
        const agents = await scanAgents().catch(() => []);
        if (!agents.some((a) => a.pid === pid)) {
          sendJson(res, 404, { ok: false, error: "pid is not a detected agent" });
          return;
        }
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          sendJson(res, 404, { ok: false, error: "process already gone or permission denied" });
          return;
        }
        sendJson(res, 200, { ok: true, pid, signal: "SIGTERM" });
        return;
      }
      if (url.pathname === "/api/rules" && req.method === "GET") {
        sendJson(res, 200, { rules: await loadRules() });
        return;
      }
      if (url.pathname === "/api/rules" && req.method === "POST") {
        if (!tokenMatches(req)) {
          sendJson(res, 403, { ok: false, error: "dashboard UI token required" });
          return;
        }
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { ok: false, error: body.error });
          return;
        }
        const parsed = parseRule({
          ...((typeof body.value === "object" && body.value !== null ? body.value : {}) as Record<string, unknown>),
          id: (body.value as { id?: unknown })?.id ?? newRuleId(),
          createdAt: new Date().toISOString(),
        });
        if (!parsed) {
          sendJson(res, 400, { ok: false, error: "invalid rule" });
          return;
        }
        const rules = await loadRules();
        rules.push(parsed);
        await saveRules(rules);
        sendJson(res, 201, { ok: true, rule: parsed });
        return;
      }
      if (url.pathname.startsWith("/api/rules/") && (req.method === "PUT" || req.method === "DELETE")) {
        if (!tokenMatches(req)) {
          sendJson(res, 403, { ok: false, error: "dashboard UI token required" });
          return;
        }
        const id = decodeURIComponent(url.pathname.slice("/api/rules/".length));
        const rules = await loadRules();
        const idx = rules.findIndex((r) => r.id === id);
        if (idx === -1) {
          sendJson(res, 404, { ok: false, error: "rule not found" });
          return;
        }
        if (req.method === "DELETE") {
          rules.splice(idx, 1);
          await saveRules(rules);
          sendJson(res, 200, { ok: true });
          return;
        }
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { ok: false, error: body.error });
          return;
        }
        const parsed = parseRule({
          ...((typeof body.value === "object" && body.value !== null ? body.value : {}) as Record<string, unknown>),
          id,
        });
        if (!parsed) {
          sendJson(res, 400, { ok: false, error: "invalid rule" });
          return;
        }
        rules[idx] = parsed;
        await saveRules(rules);
        sendJson(res, 200, { ok: true, rule: parsed });
        return;
      }
      if (url.pathname === "/api/events" && req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
        const pid = Number(url.searchParams.get("pid"));
        const hasPid = Number.isInteger(pid) && pid > 0;
        const session = url.searchParams.get("session");
        const agent = url.searchParams.get("agent")?.toLowerCase();
        const events = await store.readTail(
          limit,
          (e) =>
            (!hasPid || e.agent.pid === pid) &&
            (!session || e.agent.sessionId === session) &&
            (!agent || e.agent.name === agent),
        );
        sendJson(res, 200, { events });
        return;
      }
      if (url.pathname !== "/events") {
        sendJson(res, 404, { ok: false, error: "not found" });
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      let text: string;
      try {
        text = await readBody(req);
      } catch {
        sendJson(res, 413, { ok: false, error: "payload too large" });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        sendJson(res, 400, { ok: false, error: "malformed JSON" });
        return;
      }
      const event = await store.append(parsed);
      if (!event) {
        sendJson(res, 400, { ok: false, error: "invalid event payload" });
        return;
      }
      sendJson(res, 202, { ok: true, id: event.id });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal error" });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({
        port,
        host,
        close: () =>
          new Promise<void>((res, rej) => {
            try {
              (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
              (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            } catch {
            }
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
