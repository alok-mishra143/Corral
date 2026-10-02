export type AgentName = "opencode";

export type AgentEventType =
  | "session.started" | "session.stopped" | "session.idle"
  | "tool.started" | "tool.completed"
  | "file.read" | "file.edited" | "file.created" | "file.deleted"
  | "command.executed" | "http.request" | "http.response"
  | "permission.requested" | "error";

const TYPES: ReadonlySet<string> = new Set([
  "session.started", "session.stopped", "session.idle", "tool.started",
  "tool.completed", "file.read", "file.edited", "file.created",
  "file.deleted", "command.executed", "http.request", "http.response",
  "permission.requested", "error",
]);

export interface AgentEvent {
  id: string;
  timestamp: string;
  agent: { name: AgentName; pid?: number; sessionId?: string };
  type: AgentEventType;
  cwd?: string;
  data: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseEvent(input: unknown): AgentEvent | null {
  if (!isRecord(input)) return null;
  const { id, timestamp, agent, type, cwd, data } = input;
  if (typeof id !== "string" || !id || id.length > 128) return null;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) return null;
  if (!isRecord(agent) || agent.name !== "opencode") return null;
  if (agent.pid !== undefined && (!Number.isInteger(agent.pid) || (agent.pid as number) <= 0)) return null;
  if (agent.sessionId !== undefined && typeof agent.sessionId !== "string") return null;
  if (typeof type !== "string" || !TYPES.has(type)) return null;
  if (cwd !== undefined && typeof cwd !== "string") return null;
  if (!isRecord(data)) return null;
  return redactEvent({ id, timestamp, agent: agent as AgentEvent["agent"], type: type as AgentEventType, ...(cwd !== undefined ? { cwd } : {}), data });
}

const SENSITIVE_KEY = /api[_-]?key|apikey|auth(orization)?|bearer|token|secret|cookie|set-cookie|password|passwd|private[_-]?key|client[_-]?secret|session[_-]?key/i;
const SENSITIVE_QUERY_PARAM = /key|token|secret|auth|session|code|password/i;

export function redactHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : v;
  return out;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAM.test(key)) u.searchParams.set(key, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  return redactUnknown(value);
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactUnknown(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.toLowerCase() === "headers" && v !== null && typeof v === "object") out[k] = redactHeaders(v as Record<string, string>);
      else if (k.toLowerCase() === "url" && typeof v === "string") out[k] = redactUrl(v);
      else out[k] = redactValue(k, v);
    }
    return out;
  }
  return value;
}

export function redactEvent(event: AgentEvent): AgentEvent {
  return { ...event, data: redactUnknown(event.data) as Record<string, unknown> };
}
