
const ENDPOINT = "http://127.0.0.1:4317/events";
const RULES_URL = "http://127.0.0.1:4317/api/rules";
const SETTINGS_URL = "http://127.0.0.1:4317/api/settings";
const TIMEOUT_MS = 1500;
const RULES_TTL_MS = 5000;
const FRESH_DEADLINE_MS = 500;
void (async function ensureDaemon() {
  try {
    var h = await fetch("http://127.0.0.1:4317/health", { signal: AbortSignal.timeout(1200) });
    if (h.ok) return;
  } catch {}
  try {
    var cp: any = await (Function("return import(\"node:child_process\")")() as Promise<any>);
    var home = "";
    try {
      var e = (globalThis as any)?.process?.env as any;
      home = (e?.HOME as string) || "";
    } catch {}
    var candidates = [
      home + "/.local/bin/corral",
      home + "/.bun/bin/corral",
      "/usr/local/bin/corral",
    ];
    var fs: any = await (Function("return import(\"node:fs/promises\")")() as Promise<any>);
    for (var i = 0; i < candidates.length; i++) {
      try {
        await fs.access(candidates[i] as string);
        var child = cp.spawn(candidates[i] as string, ["daemon"], { detached: true, stdio: "ignore", shell: false });
        if (child && child.unref) child.unref();
        return;
      } catch {}
    }
  } catch {}
})();

let cachedRules: Json[] = [];
let rulesAt = 0;
let rulesRefreshing = false;

let allowDashboardAccess = false;
let settingsRefreshing = false;

function applySettings(value: unknown): boolean {
  var s = asRecord(value);
  if (!s || typeof s["allowDashboardAccess"] !== "boolean") return false;
  allowDashboardAccess = s["allowDashboardAccess"] === true;
  return true;
}

async function diskSettings(): Promise<boolean> {
  try {
    var e: any = (globalThis as any)?.process?.env;
    var home = (e?.HOME as string) || (e?.USERPROFILE as string) || "";
    if (!home) return false;
    var fs: any = await (Function("return import(\"node:fs/promises\")")() as Promise<any>);
    var text = await fs.readFile(home + "/.corral/settings.json", "utf8");
    applySettings(JSON.parse(text));
    return true;
  } catch {
    return false;
  }
}

function refreshSettings(): void {
  if (settingsRefreshing) return;
  settingsRefreshing = true;
  void fetch(SETTINGS_URL, { signal: AbortSignal.timeout(2000) })
    .then(function (r: any) { return r.ok ? r.json() : null; })
    .then(function (j: any) {
      if (j && applySettings(asRecord(j["settings"]))) return;
      return diskSettings();
    })
    .catch(function () { return diskSettings(); })
    .finally(function () { settingsRefreshing = false; });
}

async function refreshSettingsSync(): Promise<void> {
  try {
    var r = await fetch(SETTINGS_URL, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      var j: any = await r.json();
      if (applySettings(asRecord(j["settings"]))) return;
    }
  } catch { /* fall through to disk */ }
  await diskSettings();
}

async function diskRules(): Promise<Json[] | null> {
  try {
    var home = "";
    try {
      var e = (globalThis as any)?.process?.env as any;
      home = (e?.HOME as string) || "";
      if (!home && e?.USERPROFILE) home = e.USERPROFILE as string;
    } catch { /* ignore */ }
    if (!home) return null;
    var fs: any = null;
    try {
      fs = await (Function("return import(\"node:fs/promises\")")() as Promise<any>);
    } catch { return null; }
    var text = await fs.readFile(home + "/.corral/rules.json", "utf8");
    var parsed: any = JSON.parse(text);
    var list = Array.isArray(parsed) ? parsed : parsed?.rules;
    if (!Array.isArray(list)) return null;
    return list.filter(function (r: any) { return r && typeof r === "object" && r?.enabled !== false; });
  } catch {
    return null;
  }
}

function applyRules(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  cachedRules = (list as Json[]).filter((r) => (r as Json)?.["enabled"] !== false);
  rulesAt = Date.now();
  return true;
}

function refreshRules(): void {
  refreshSettings();
  if (rulesRefreshing) return;
  rulesRefreshing = true;
  void fetch(RULES_URL, { signal: AbortSignal.timeout(2000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!applyRules((j as Json | null)?.["rules"])) return diskRules();
      return null;
    })
    .then((disk) => { if (disk) applyRules(disk); })
    .catch(() => undefined)
    .finally(() => {
      rulesRefreshing = false;
    });
}

async function refreshRulesSync(): Promise<void> {
  await refreshSettingsSync();
  try {
    var r = await fetch(RULES_URL, { signal: AbortSignal.timeout(2000) });
    var j = r.ok ? await r.json() : null;
    if (applyRules((j as Json | null)?.["rules"])) return;
  } catch { /* fall through to disk */ }
  try {
    var disk = await diskRules();
    if (disk) applyRules(disk);
  } catch { /* fail open only if nothing was ever loadable */ }
}

function withDeadline(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    p.then(
      function () { return undefined; },
      function () { return undefined; },
    ),
    new Promise<void>(function (resolve) { setTimeout(resolve, ms); }),
  ]);
}

function globToRegex(glob: string): RegExp | null {
  try {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") {
          re += ".*";
          i++;
          if (glob[i + 1] === "/") {
            re += ".";
            i++;
          }
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if ("\\.+^${}()|[]".includes(c ?? "")) {
        re += "\\" + c;
      } else {
        re += c;
      }
    }
    return new RegExp("^" + re + "$", "s");
  } catch {
  return null;
  }
}

type Json = Record<string, unknown>;

function matchFileRule(glob: string, filePath: string, cwd?: string): boolean {
  if (!filePath) return false;
  const re = globToRegex(glob);
  if (!re) return false;
  const norm = filePath.replace(/\\/g, "/");
  if (re.test(filePath) || re.test(norm)) return true;
  const resolved = resolveFile(filePath, cwd);
  if (re.test(resolved)) return true;
  const base = norm.split("/").pop() ?? norm;
  if (re.test(base)) return true;
  const globNoDot = glob.charAt(0) === "." ? glob.slice(1) : glob;
  const baseNoDot = base.charAt(0) === "." ? base.slice(1) : base;
  const reAlt = isBasenameOnly(glob) && (globNoDot !== glob || baseNoDot !== base) ? globToRegex(globNoDot) : null;
  if (reAlt && reAlt.test(baseNoDot)) return true;
  try {
    const lower = new RegExp(re.source, "s" + (re.ignoreCase ? "" : "i"));
    if (lower.test(filePath.toLowerCase()) || lower.test(norm.toLowerCase()) ||
        lower.test(resolved.toLowerCase()) || lower.test(base.toLowerCase())) return true;
    if (reAlt) {
      const altLower = new RegExp(reAlt.source, "s" + (reAlt.ignoreCase ? "" : "i"));
      if (altLower.test(baseNoDot.toLowerCase())) return true;
    }
  } catch { /* ignore */ }
  return false;
}

interface BlockCtx {
  sessionId?: string;
  cwd?: string;
  file?: string;
  command?: string;
  url?: string;
  writeContent?: string;
  tool?: string;
  searchPattern?: string;
  args?: Json;
}

function isSearchTool(name: string): boolean {
  return /grep|ripgrep|search|find|glob|list|^ls|tree|walk|scan|codebase|knowledge/i.test(name || "");
}

function isContentSearch(name: string): boolean {
  return /grep|search|find|\brg\b|\bag\b|ack/i.test(name || "");
}

function isBasenameOnly(glob: string): boolean {
  return literalPrefix(glob).indexOf("/") === -1;
}

function searchPatternOf(args: Json | undefined): string | undefined {  if (!args) return undefined;
  var keys = ["pattern", "query", "text", "term", "regex", "regexp", "glob", "include", "filePattern", "pathFilter", "filter"];
  for (var i = 0; i < keys.length; i++) {
    var v = args[keys[i] ?? ""];
    if (typeof v === "string" && v.length > 0 && v.length < 5000) return v;
  }
  return undefined;
}

function matchCommandRule(pattern: string, command: string): boolean {
  if (!pattern || !command) return false;
  if (pattern.length > 2 && pattern.charAt(0) === "/" && pattern.lastIndexOf("/") > 0) {
    var end = pattern.lastIndexOf("/");
    try {
      return new RegExp(pattern.slice(1, end), pattern.slice(end + 1)).test(command);
    } catch { return false; }
  }
  return command.toLowerCase().indexOf(pattern.toLowerCase()) !== -1;
}

function matchHttpRule(pattern: string, url: string): boolean {
  var p = (pattern || "").trim().toLowerCase();
  var u = (url || "").trim();
  if (!p || !u) return false;
  if (p.indexOf("://") !== -1 || p.indexOf("/") !== -1) return u.toLowerCase().indexOf(p) === 0;
  var m = u.match(/^[a-z0-9+.-]+:\/\/([^/]+)/i);
  var host = (m && m[1] ? m[1] : u).toLowerCase();
  return host === p || host.slice(-p.length - 1) === "." + p;
}

function expandVars(cmd: string): string {
  var out = cmd;
  var h = homeDir();
  out = out.replace(/\$(HOME|home)|\$\{(HOME|home)\}/g, h);
  var map: Record<string, string> = {};
  var re = /(?:^|[;&|`\s])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|`]+)/g;
  var m: RegExpExecArray | null;
  var guard = 0;
  while ((m = re.exec(cmd)) !== null && guard++ < 50) {
    var k = m[1] ?? "";
    var v = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
    if (k && v && !(k in map)) map[k] = v;
  }
  for (var k2 in map) {
    out = out.replace(new RegExp("\\$\\{" + k2 + "\\}|\\$" + k2 + "(?![A-Za-z0-9_])", "g"), map[k2] ?? "");
  }
  return out;
}

function pathsFromCommand(cmd: string): string[] {
  var out: string[] = [];
  if (!cmd) return out;
  var chunks = cmd.split(/&&|\|\||[;|&`]/);
  for (var ci = 0; ci < chunks.length; ci++) {
    var chunk = chunks[ci] ?? "";
    var toks: string[] = [];
    var cur = "";
    var q: string | null = null;
    for (var i = 0; i < chunk.length; i++) {
      var ch = chunk[i] ?? "";
      if (q) {
        if (ch === q) { q = null; }
        else { cur += ch; }
      } else if (ch === '"' || ch === "'") { q = ch; }
      else if (ch === " " || ch === "\t" || ch === "(" || ch === ")" || ch === "<" || ch === ">") {
        if (cur) { toks.push(cur); cur = ""; }
      } else { cur += ch; }
    }
    if (cur) toks.push(cur);
    for (var ti = 0; ti < toks.length; ti++) {
      var t = (toks[ti] ?? "").trim();
      if (!t || t === "-" || t === "--") continue;
      var eq = t.indexOf("=");
      var val = eq > 0 ? t.slice(eq + 1) : t;
      val = val.trim();
      if (!val) continue;
      if (/^-[a-zA-Z0-9-]+$/.test(val)) continue;
      if (val.indexOf("*") !== -1 || val.indexOf("?") !== -1) {
        if (/^[a-z0-9+.-]+:\/\//i.test(val)) continue;
        out.push(val);
        continue;
      } // a flag, not a path
      if (/\.[a-zA-Z0-9]{1,5}$/.test(val) || val.indexOf("/") !== -1 || val.charAt(0) === "~" || val.charAt(0) === ".") {
        if (/^[a-z0-9+.-]+:\/\//i.test(val)) continue;
        out.push(val);
        var colon = val.lastIndexOf(":");
        if (colon > 0 && colon < val.length - 1) {
          var side = val.slice(colon + 1);
          if (side && out.indexOf(side) === -1) out.push(side);
        }
      }
    }
  }
  return out;
}

function findBlockingRule(ctx: BlockCtx): Json | null {
  var selfHit = selfProtectHit(ctx);
  if (selfHit) return selfHit;
  for (const r of cachedRules) {
    const scope = asRecord(r["scope"]) ?? {};
    const match = asRecord(r["match"]);
    if (!match) continue;
    const sSession = str(scope["sessionId"]);
    if (sSession && sSession !== ctx.sessionId) continue;
    const sCwd = str(scope["cwdPrefix"]);
    if (sCwd) {
      if (!ctx.cwd) continue;
      const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!norm(ctx.cwd).startsWith(norm(sCwd))) continue;
    }
    const kind = str(match["kind"]);
    const value = str(match["value"]);
    if (!kind || !value) continue;
    if (kind === "file") {
      if (ctx.file && (matchFileRule(value, ctx.file, ctx.cwd) || dirSweepHit(value, [ctx.file]))) return r;
      if (ctx.tool && isSearchTool(ctx.tool)) {
        var scopeDir = ctx.file || ctx.cwd;
        if (scopeDir && dirSweepHit(value, [scopeDir])) return r;
        if (scopeDir && isContentSearch(ctx.tool) && isBasenameOnly(value)) return r;
      }
      if (ctx.searchPattern) {
        var sp = pathsFromCommand(ctx.searchPattern).concat(pathsFromText(ctx.searchPattern));
        for (var spi = 0; spi < sp.length; spi++) {
          if (matchFileRule(value, sp[spi] ?? "", ctx.cwd)) return r;
        }
        if (dirSweepHit(value, [ctx.searchPattern])) return r;
      }
      if (ctx.command) {
        var rawCmd = ctx.command;
        var cmd = expandVars(rawCmd);
        var cand = pathsFromCommand(cmd);
        var txt = pathsFromText(cmd);
        for (var tpi = 0; tpi < txt.length; tpi++) {
          if (cand.indexOf(txt[tpi] ?? "") === -1) cand.push(txt[tpi] ?? "");
        }
        for (var pi = 0; pi < cand.length; pi++) {
          if (matchFileRule(value, cand[pi] ?? "", ctx.cwd)) return r;
        }
        if (cmd.indexOf("$") !== -1) {
          var av = assignedValues(cmd);
          for (var ai = 0; ai < av.length; ai++) {
            if (matchFileRule(value, av[ai] ?? "", ctx.cwd)) return r;
          }
        }
        var dec = decodedPaths(cmd);
        for (var di = 0; di < dec.length; di++) {
          if (matchFileRule(value, dec[di] ?? "", ctx.cwd)) return r;
        }
        if (COPY_ARCHIVE.test(cmd) && dirSweepHit(value, cand)) return r;
        for (var ti = 0; ti < cand.length; ti++) {
          if (isTainted(cand[ti] ?? "", ctx.cwd)) {
            return { id: "tainted-script", name: "tainted script", enabled: true, match: { kind: "file", value: value } };
          }
        }
      }
      if (ctx.writeContent) {
        var bodyPaths = pathsFromText(ctx.writeContent);
        for (var bi = 0; bi < bodyPaths.length; bi++) {
          if (matchFileRule(value, bodyPaths[bi] ?? "", ctx.cwd)) {
            markTainted(ctx.file, ctx.cwd);
            return r;
          }
        }
      }
    }
    if (kind === "command" && ctx.command && matchCommandRule(value, ctx.command)) return r;
    if (kind === "http" && ctx.url && matchHttpRule(value, ctx.url)) return r;
  }
  return null;
}

function selfProtectHit(ctx: BlockCtx): Json | null {
  var dash = dashboardHit(ctx);
  if (dash) return dash;
  var fileCands: string[] = [];
  if (ctx.file) fileCands.push(ctx.file);
  if (ctx.command) {
    var cp = pathsFromCommand(ctx.command);
    var tp = pathsFromText(ctx.command);
    for (var i = 0; i < tp.length; i++) {
      if (cp.indexOf(tp[i] ?? "") === -1) cp.push(tp[i] ?? "");
    }
    fileCands = fileCands.concat(cp);
  }
  for (var fi = 0; fi < fileCands.length; fi++) {
    for (var si = 0; si < SELF_PROTECT.length; si++) {
      if (matchFileRule(SELF_PROTECT[si] ?? "", fileCands[fi] ?? "", ctx.cwd)) {
        return { id: "self-protect", name: "firewall self-protection", enabled: true, match: { kind: "file", value: SELF_PROTECT[si] ?? "" } };
      }
    }
  }
  if (ctx.writeContent) {
    var bp = pathsFromText(ctx.writeContent);
    for (var bi = 0; bi < bp.length; bi++) {
      for (var sj = 0; sj < SELF_PROTECT.length; sj++) {
        if (matchFileRule(SELF_PROTECT[sj] ?? "", bp[bi] ?? "", ctx.cwd)) return { id: "self-protect", name: "firewall self-protection", enabled: true, match: { kind: "file", value: SELF_PROTECT[sj] ?? "" } };
      }
    }
  }
  if (ctx.command && isFirewallKill(ctx.command)) {
    return { id: "self-protect", name: "firewall self-protection", enabled: true, match: { kind: "command", value: "firewall tampering" } };
  }
  return null;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SENSITIVE = /api[_-]?key|apikey|auth(orization)?|bearer|token|secret|cookie|set-cookie|password|passwd|private[_-]?key|client[_-]?secret/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (k.toLowerCase() === "headers" && v !== null && typeof v === "object") {
        const h: Json = {};
        for (const [hk, hv] of Object.entries(v as Json)) {
          h[hk] = SENSITIVE.test(hk) ? "[REDACTED]" : sanitize(hv);
        }
        out[k] = h;
      } else {
        out[k] = SENSITIVE.test(k) ? "[REDACTED]" : sanitize(v);
      }
    }
    return out;
  }
  if (typeof value === "string" && value.length > 4000) {
    return value.slice(0, 4000) + "…[truncated]";
  }
  return value;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asRecord(v: unknown): Json | undefined {
  return typeof v === "object" && v !== null ? (v as Json) : undefined;
}

var taintedScripts: string[] = [];
var taintedLoaded = false;
function taintFile(): string | null {
  try {
    var e = (globalThis as any)?.process?.env as any;
    var home = (e?.HOME as string) || (e?.USERPROFILE as string) || "";
    return home ? home + "/.corral/tainted.json" : null;
  } catch { return null; }
}
function loadTainted(): void {
  if (taintedLoaded) return;
  taintedLoaded = true;
  void (async function () {
    try {
      var f = taintFile();
      if (!f) return;
      var fs: any = await (Function("return import(\"node:fs/promises\")")() as Promise<any>);
      var text = await fs.readFile(f, "utf8");
      var list = JSON.parse(text);
      if (Array.isArray(list)) {
        taintedScripts = (list as unknown[]).filter(function (x) { return typeof x === "string"; }) as string[];
      }
    } catch { /* no taint file yet */ }
  })();
}
function saveTainted(): void {
  void (async function () {
    try {
      var f = taintFile();
      if (!f) return;
      var fs: any = await (Function("return import(\"node:fs/promises\")")() as Promise<any>);
      await fs.writeFile(f, JSON.stringify(taintedScripts.slice(-200)), "utf8");
    } catch { /* best-effort */ }
  })();
}
function markTainted(p: string | undefined, cwd?: string): void {
  if (!p) return;
  var r = resolveFile(p, cwd);
  if (taintedScripts.indexOf(r) === -1) {
    taintedScripts.push(r);
    if (taintedScripts.length > 200) taintedScripts.shift();
    saveTainted();
  }
}
function isTainted(p: string, cwd?: string): boolean {
  var r = resolveFile(p, cwd);
  return taintedScripts.indexOf(r) !== -1;
}

function writeContentOf(args: Json | undefined): string | undefined {
  if (!args) return undefined;
  var keys = ["content", "text", "code", "body", "input", "data", "patch", "edits"];
  for (var i = 0; i < keys.length; i++) {
    var v = args[keys[i] ?? ""];
    if (typeof v === "string" && v.length > 0 && v.length < 500000) return v;
  }
  return undefined;
}

function pathsFromText(text: string): string[] {
  var out: string[] = [];
  if (!text) return out;
  var re = /["']([^"'`]{1,500})["']|([~.]?\/[^\s"'`$(){}<>|&;]+)/g;
  var m: RegExpExecArray | null;
  var guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 500) {
    var cand = (m[1] ?? m[2] ?? "").trim();
    if (!cand || cand === "-" || cand === "--") continue;
    if (/^[a-z0-9+.-]+:\/\//i.test(cand)) continue;
    if (/\.[a-zA-Z0-9]{1,6}$/.test(cand) || cand.indexOf("/") !== -1 || cand.charAt(0) === "~" || cand.charAt(0) === ".") {
      if (out.indexOf(cand) === -1) out.push(cand);
    }
  }
  return out;
}

function decodedPaths(text: string): string[] {
  var out: string[] = [];
  if (!text || text.length < 16) return out;
  function scanBin(bin: string): void {
    if (!bin || bin.length > 10000) return;
    var inner = pathsFromText(bin);
    for (var i = 0; i < inner.length; i++) {
      if (out.indexOf(inner[i] ?? "") === -1) out.push(inner[i] ?? "");
    }
    var innerCmd = pathsFromCommand(bin);
    for (var j = 0; j < innerCmd.length; j++) {
      if (out.indexOf(innerCmd[j] ?? "") === -1) out.push(innerCmd[j] ?? "");
    }
  }
  var re = /[A-Za-z0-9+/]{24,}={0,2}/g;
  var m: RegExpExecArray | null;
  var guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 50) {
    var tok = m[0] ?? "";
    if (tok.length % 4 !== 0 || tok.length > 20000) continue;
    try {
      var bin = (globalThis as any)?.Buffer
        ? (globalThis as any).Buffer.from(tok, "base64").toString("utf8")
        : atob(tok);
      scanBin(bin);
    } catch { /* not valid base64 — ignore */ }
  }
  var hx = /[0-9a-fA-F]{32,}/g;
  guard = 0;
  while ((m = hx.exec(text)) !== null && guard++ < 50) {
    var h = m[0] ?? "";
    if (h.length % 2 !== 0 || h.length > 20000 || !/[a-fA-F]/.test(h) || !/[0-9]/.test(h)) continue;
    try {
      var hb = (globalThis as any)?.Buffer
        ? (globalThis as any).Buffer.from(h, "hex").toString("utf8")
        : null;
      if (hb) scanBin(hb);
    } catch { /* ignore */ }
  }
  return out;
}

function literalPrefix(glob: string): string {
  var i = glob.search(/[*?[{]/);
  return (i === -1 ? glob : glob.slice(0, i)).replace(/\\/g, "/").replace(/\/+$/, "");
}

function extOf(s: string): string {
  var m = s.match(/\.([a-zA-Z0-9]{1,6})(?:[*?]*)$/);
  return m ? ("." + (m[1] ?? "").toLowerCase()) : "";
}

function dirSweepHit(glob: string, cmdPaths: string[]): boolean {
  var lit = literalPrefix(glob);
  for (var i = 0; i < cmdPaths.length; i++) {
    var p = (cmdPaths[i] ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!p) continue;
    var pLit = literalPrefix(p);
    if (lit && pLit && (lit === pLit || lit.indexOf(pLit + "/") === 0 || pLit.indexOf(lit + "/") === 0)) return true;
    if (p.indexOf("*") !== -1 || p.indexOf("?") !== -1) {
      var ge = extOf(glob);
      var pe = extOf(p);
      if (ge && pe && ge === pe) return true;
      if (!pe && !lit) return true;
    }
  }
  return false;
}

var COPY_ARCHIVE = /\b(cp|mv|ln|rsync|scp|tar|zip|unzip|dd|cat|tee|tail|head|less|more|find|grep|rg|ag|ack|sed|awk|xxd|od|hexdump|strings|jq|python3?|perl|ruby|node|php|git)\b/i;

var SELF_PROTECT = ["**/.corral/rules.json", "**/.corral/tainted.json", "**/opencode/plugins/corral.ts"];

var DASHBOARD_ORIGIN = /(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[?::1\]?):4317(?:[\s"'`)\]}\\/,?#-]|$)/i;
var DASHBOARD_WRITE = /(?:^|[\s"'`])(?:-X|--request|-d|--data|--data-raw|--data-binary|-F|--form)(?:\s|=)|\b(?:POST|PUT|PATCH|DELETE)\b/i;

function isDashboardUrl(url: string | undefined): boolean {
  if (!url) return false;
  return DASHBOARD_ORIGIN.test(url);
}

function looksLikeDashboardWrite(args: Json | undefined, command: string | undefined): boolean {
  if (args) {
    var m = str(args["method"]);
    if (m && /^(POST|PUT|PATCH|DELETE)$/i.test(m)) return true;
  }
  if (command && DASHBOARD_WRITE.test(command)) return true;
  return false;
}

function dashboardHit(ctx: BlockCtx): Json | null {
  var touched = isDashboardUrl(ctx.url) || (ctx.command != null && DASHBOARD_ORIGIN.test(ctx.command));
  if (!touched) return null;
  var write = looksLikeDashboardWrite(ctx.args, ctx.command);
  if (!allowDashboardAccess || write) {
    return {
      id: "dashboard-access",
      name: write ? "dashboard write refused" : "firewall self-protection",
      enabled: true,
      match: { kind: "http", value: "127.0.0.1:4317" },
    };
  }
  return null;
}

function isFirewallKill(cmd: string): boolean {
  return /corral|127\.0\.0\.1:4317|localhost:4317/.test(cmd) &&
    /\b(kill|pkill|killall|rm|truncate|tee|:?\s*>\s*$|>)/.test(cmd);
}

function assignedValues(cmd: string): string[] {
  var out: string[] = [];
  var re = /(?:^|[;&|`\s])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|`]+)/g;
  var m: RegExpExecArray | null;
  var guard = 0;
  while ((m = re.exec(cmd)) !== null && guard++ < 50) {
    var v = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
    if (v && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}
function send(
  type: string,
  opts: { sessionId?: unknown; cwd?: unknown; data?: unknown },
): void {
  try {
    const sessionId = str(opts.sessionId);
    const cwd = str(opts.cwd);
    let pid = undefined;
    try {
      const p = (globalThis as any)?.process?.pid;
      if (typeof p === "number" && Number.isInteger(p) && p > 0) pid = p;
    } catch { /* ignore */ }
    const body = JSON.stringify({
      id: uid(),
      timestamp: new Date().toISOString(),
      agent: { name: "opencode", ...(pid !== undefined ? { pid } : {}), ...(sessionId ? { sessionId } : {}) },
      type,
      ...(cwd ? { cwd } : {}),
      data: sanitize(asRecord(opts.data) ?? {}),
    });
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  } catch {
  }
}

function sessionOf(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const s = str(c);
    if (s) return s;
    const r = asRecord(c);
    if (r) {
      const nested =
        str(r["sessionID"]) ?? str(r["sessionId"]) ?? str(r["session_id"]) ?? str(r["id"]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function fileOf(args: Json | undefined): string | undefined {
  if (!args) return undefined;
  return (
    str(args["filePath"]) ??
    str(args["filepath"]) ??
    str(args["file"]) ??
    str(args["filename"]) ??
    str(args["fileName"]) ??
    str(args["path"]) ??
    str(args["absPath"]) ??
    str(args["absolutePath"]) ??
    str(args["targetFile"]) ??
    str(args["target"]) ??
    str(args["uri"]) ??
    str(args["directory"]) ??
    str(args["dir"]) ??
    str(args["folder"]) ??
    str(args["root"]) ??
    str(args["rootPath"]) ??
    str(args["workspace"])
  );
}

function fileUrlToPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  var m = url.match(/^file:\/\/([^?#]*)/i);
  if (!m) return undefined;
  try {
    var p = decodeURIComponent(m[1] ?? "");
    if (!p) return undefined;
    var host = (url.match(/^file:\/\/([^/]*)/i) ?? [])[1] ?? "";
    if (host && host !== "" && host !== "localhost") return undefined;
    return p.charAt(0) === "/" ? p : "/" + p;
  } catch {
    return undefined;
  }
}

function cwdOf(input: any, output: any, fallback: string | undefined): string | undefined {
  try {
    var c = input?.cwd ?? output?.cwd ?? input?.directory ?? output?.directory;
    if (typeof c === "string" && c) return c;
  } catch { /* ignore */ }
  return fallback;
}

function fileUrlHit(url: string | undefined, sessionId: string | undefined, cwd: string | undefined): Json | null {
  var p = fileUrlToPath(url);
  if (!p) return null;
  for (const r of cachedRules) {
    const match = asRecord(r["match"]);
    const value = match ? str(match["value"]) : undefined;
    if (!match || str(match["kind"]) !== "file" || !value) continue;
    const scope = asRecord(r["scope"]) ?? {};
    const sSession = str(scope["sessionId"]);
    if (sSession && sSession !== sessionId) continue;
    const sCwd = str(scope["cwdPrefix"]);
    if (sCwd) {
      if (!cwd) continue;
      const norm = (x: string): string => x.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!norm(cwd).startsWith(norm(sCwd))) continue;
    }
    if (matchFileRule(value, p, cwd)) return r;
  }
  for (var si = 0; si < SELF_PROTECT.length; si++) {
    if (matchFileRule(SELF_PROTECT[si] ?? "", p, cwd)) {
      return { id: "self-protect", name: "firewall self-protection", enabled: true, match: { kind: "file", value: SELF_PROTECT[si] ?? "" } };
    }
  }
  return null;
}

function commandOf(args: Json | undefined, toolName: string): string | undefined {
  if (!args) return undefined;
  var c = str(args["command"]) ?? str(args["cmd"]) ?? str(args["script"]);
  if (c) return c;
  if (/bash|shell|exec|command/i.test(toolName)) {
    for (var k of ["input", "text", "args"]) {
      var v = args[k];
      if (typeof v === "string" && v.trim()) return v;
      if (Array.isArray(v)) {
        var s = (v as unknown[]).filter(function (x) { return typeof x === "string"; }).join(" ");
        if (s.trim()) return s;
      }
    }
  }
  return undefined;
}

function urlOf(args: Json | undefined): string | undefined {
  if (!args) return undefined;
  return (
    str(args["url"]) ?? str(args["URL"]) ?? str(args["href"]) ?? str(args["uri"])
  );
}
function homeDir(): string {
  try {
    const p = (globalThis as any)?.process?.env?.HOME as unknown;
    if (typeof p === "string" && p) return p;
  } catch { /* ignore */ }
  return "";
}

function resolveFile(p: string, cwd?: string): string {
  let s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const h0 = homeDir();
  if (h0) s = s.replace(/^\$(HOME|home)|\$\{(HOME|home)\}/, h0.replace(/\\/g, "/").replace(/\/+$/, ""));
  if (s === "~" || s.startsWith("~/")) {
    const h = homeDir();
    if (h) s = h.replace(/\\/g, "/").replace(/\/+$/, "") + s.slice(1);
  }
  if (cwd && !s.startsWith("/")) s = cwd.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + s;
  const parts = s.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

function isWriteTool(tool: string): boolean {
  const t = tool.toLowerCase();
  return (
    t === "write" || t === "edit" || t.includes("write") || t.includes("edit") || t.includes("apply")
  );
}

function isReadTool(tool: string): boolean {
  const t = tool.toLowerCase();
  return t === "read" || t.includes("read");
}

function handleTool(
  phase: "started" | "completed",
  tool: unknown,
  args: unknown,
  result: unknown,
  sessionId: string | undefined,
  cwd: string | undefined,
): void {
  const name = str(asRecord(tool)?.["name"]) ?? str(tool) ?? "unknown";
  const a = asRecord(args) ?? {};
  const base = { tool: name, sessionId };

  send(phase === "started" ? "tool.started" : "tool.completed", {
    sessionId,
    cwd,
    data: {
      ...base,
      input: phase === "started" ? a : undefined,
      output:
        phase === "completed"
          ? typeof result === "string"
            ? result.slice(0, 2000)
            : result
          : undefined,
    },
  });

  const file = fileOf(a);
  if (file && isWriteTool(name)) {
    send("file.edited", { sessionId, cwd, data: { ...base, file, tool: name } });
  } else if (file && isReadTool(name)) {
    send("file.read", { sessionId, cwd, data: { ...base, file, tool: name } });
  }
}

export const CorralPlugin: any = async (ctx: any) => {
  const cwd: string | undefined = str(ctx?.directory) ?? str(ctx?.project?.directory);
  refreshRules();
  loadTainted();

  return {
    event: async ({ event }: any) => {
      try {
        const type = str(event?.type);
        if (!type || !type.startsWith("session.")) return;
        const props = asRecord(event?.properties) ?? {};
        const sessionId = sessionOf(props["sessionID"], props["session"], props, event?.sessionID);
        switch (type) {
          case "session.created":
            send("session.started", { sessionId, cwd, data: { sessionId } });
            break;
          case "session.deleted":
            send("session.stopped", { sessionId, cwd, data: { sessionId } });
            break;
          case "session.idle":
            send("session.idle", { sessionId, cwd, data: { sessionId } });
            break;
          case "session.error":
            send("error", {
              sessionId,
              cwd,
              data: { sessionId, error: str(props["error"]) ?? "session error" },
            });
            break;
          default:
            break; // compacted/updated/diff/status carry no corral mapping
        }
      } catch {
      }
    },

    "tool.execute.before": async (input: any, output: any) => {
      try {
        const tool = input?.tool ?? output?.tool ?? "unknown";
        const args = output?.args ?? input?.args ?? {};
        const sessionId = sessionOf(input?.sessionID, output?.sessionID, input, output);
        await withDeadline(refreshRulesSync(), FRESH_DEADLINE_MS);
        const name = str(asRecord(tool)?.["name"]) ?? str(tool) ?? "unknown";
        const a = asRecord(args) ?? {};
        const callCwd = cwdOf(input, output, cwd) ?? cwdOf(args, output, cwd);
        const file = fileOf(a);
        const command = commandOf(a, name);
        const url = urlOf(a);
        const writeContent = writeContentOf(a);
        const searchPattern = searchPatternOf(a);
        const ctx: BlockCtx = { sessionId, cwd: callCwd, file, command, url, writeContent, tool: name, searchPattern, args: a };
        const hit = findBlockingRule(ctx) ?? fileUrlHit(url, sessionId, callCwd);
        if (hit) {
          const ruleId = str(hit["id"]) ?? "unknown-rule";
          const hitKind = str(asRecord(hit["match"])?.["kind"]) ?? "match";
          const hitVal = str(asRecord(hit["match"])?.["value"]) ?? "";
          var shownFile = ctx.file;
          if (!shownFile && hitKind === "file" && ctx.command) {
            var cands = pathsFromCommand(ctx.command).concat(pathsFromText(ctx.command));
            for (var ci2 = 0; ci2 < cands.length; ci2++) {
              if (matchFileRule(hitVal, cands[ci2] ?? "", ctx.cwd)) { shownFile = cands[ci2]; break; }
            }
          }
          if (!shownFile) {
            var fp = fileUrlToPath(ctx.url);
            if (fp && hitKind === "file" && matchFileRule(hitVal, fp, ctx.cwd)) shownFile = fp;
          }
          send("permission.requested", {
            sessionId,
            cwd: ctx.cwd,
            data: {
              blocked: true,
              ruleId,
              ruleName: str(hit["name"]),
              tool: name,
              sessionId,
              ...(shownFile ? { file: shownFile } : {}),
              ...(ctx.command ? { command: ctx.command.slice(0, 500) } : {}),
              ...(ctx.url ? { url: ctx.url } : {}),
            },
          });
          throw new Error(
            "Blocked by corral firewall rule " + ruleId + " (" +
              (str(asRecord(hit["match"])?.["kind"]) ?? "match") + ":" +
              (str(asRecord(hit["match"])?.["value"]) ?? "") +
              "). Manage rules at http://127.0.0.1:4317/",
          );
        }
        handleTool("started", tool, args, undefined, sessionId, ctx.cwd);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Blocked by corral firewall")) throw err;
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      try {
        if (Date.now() - rulesAt > RULES_TTL_MS) refreshRules();
        const tool = input?.tool ?? output?.tool ?? "unknown";
        const args = input?.args ?? output?.args ?? {};
        const result = output?.output ?? output?.result ?? output?.title;
        const sessionId = sessionOf(input?.sessionID, output?.sessionID, input, output);
        handleTool("completed", tool, args, result, sessionId, cwd);
      } catch {
      }
    },

    "file.edited": async (input: any, output: any) => {
      try {
        const file =
          str(input?.file) ?? str(output?.file) ?? fileOf(asRecord(input?.args) ?? asRecord(output?.args));
        const sessionId = sessionOf(input?.sessionID, output?.sessionID);
        send("file.edited", { sessionId, cwd, data: { file, sessionId } });
      } catch {
      }
    },

    "command.executed": async (input: any, output: any) => {
      try {
        const command = str(input?.command) ?? str(output?.command) ?? "";
        const sessionId = sessionOf(input?.sessionID, output?.sessionID);
        send("command.executed", {
          sessionId,
          cwd,
          data: { command: command.slice(0, 1000), sessionId },
        });
      } catch {
      }
    },

    "permission.asked": async (input: any) => {
      try {
        const sessionId = sessionOf(input?.sessionID, input);
        send("permission.requested", {
          sessionId,
          cwd,
          data: { permission: input?.permission ?? input, sessionId },
        });
      } catch {
      }
    },
  };
};

export const plugin: any = CorralPlugin;
