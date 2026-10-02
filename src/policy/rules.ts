import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RuleScope {
  sessionId?: string;
  cwdPrefix?: string;
}

export type RuleKind = "file" | "command" | "http";

export interface RuleMatch {
  kind: RuleKind;
  value: string;
}

export interface FirewallRule {
  id: string;
  name?: string;
  enabled: boolean;
  action: "deny";
  scope: RuleScope;
  match: RuleMatch;
  createdAt?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseRule(item: unknown): FirewallRule | null {
  if (!isRecord(item)) return null;
  const { id, name, enabled, scope, match, createdAt } = item;
  if (typeof id !== "string" || !id || id.length > 64) return null;
  if (name !== undefined && (typeof name !== "string" || name.length > 160)) return null;
  if (!isRecord(match) || (match.kind !== "file" && match.kind !== "command" && match.kind !== "http") || typeof match.value !== "string" || !match.value || match.value.length > 1024) return null;
  let sc: RuleScope = {};
  if (scope !== undefined) {
    if (!isRecord(scope)) return null;
    if (scope.sessionId !== undefined && (typeof scope.sessionId !== "string" || !scope.sessionId || scope.sessionId.length > 256)) return null;
    if (scope.cwdPrefix !== undefined && (typeof scope.cwdPrefix !== "string" || !scope.cwdPrefix || scope.cwdPrefix.length > 1024)) return null;
    sc = { ...(typeof scope.sessionId === "string" ? { sessionId: scope.sessionId } : {}), ...(typeof scope.cwdPrefix === "string" ? { cwdPrefix: scope.cwdPrefix } : {}) };
  }
  return {
    id,
    ...(typeof name === "string" ? { name } : {}),
    enabled: typeof enabled === "boolean" ? enabled : true,
    action: "deny",
    scope: sc,
    match: { kind: match.kind as RuleKind, value: match.value as string },
    ...(typeof createdAt === "string" ? { createdAt } : {}),
  };
}

export function defaultRulesPath(): string {
  return join(homedir(), ".corral", "rules.json");
}

export async function loadRules(path: string = defaultRulesPath()): Promise<FirewallRule[]> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) return [];
  const out: FirewallRule[] = [];
  for (const item of list) {
    const r = parseRule(item);
    if (r) out.push(r);
  }
  return out;
}

export async function saveRules(
  rules: FirewallRule[],
  path: string = defaultRulesPath(),
): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, JSON.stringify({ version: 1, rules }, null, 2) + "\n", "utf8");
}

export function newRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ruleKey(rule: Pick<FirewallRule, "match">): string {
  return `${rule.match.kind}\u0000${rule.match.value}`;
}

export function describeRule(rule: FirewallRule): string {
  const scope =
    rule.scope.sessionId != null
      ? `session ${rule.scope.sessionId.slice(0, 12)}…`
      : rule.scope.cwdPrefix != null
        ? `project ${rule.scope.cwdPrefix}`
        : "all agents";
  return `${rule.match.kind}:${rule.match.value} → deny (${scope})`;
}
