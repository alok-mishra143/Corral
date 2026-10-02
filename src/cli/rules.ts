import { describeRule, loadRules, newRuleId, saveRules, type FirewallRule } from "../policy/rules.js";
import { logger } from "../utils/logger.js";

function flag(argv: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(n + "="));
    if (eq) return eq.slice(n.length + 1);
  }
  return undefined;
}

export async function runRules(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "list" || !sub) {
    const rules = await loadRules();
    if (rules.length === 0) {
      logger.info("No rules. Example: corral rules deny --file '**/.env*'");
      return;
    }
    for (const r of rules) console.log(`${r.enabled ? "[on] " : "[off]"}${r.id}  ${describeRule(r)}`);
    return;
  }
  if (sub === "deny") {
    const file = flag(rest, "--file");
    const command = flag(rest, "--command");
    const http = flag(rest, "--http", "--url");
    const kind = file ? "file" : command ? "command" : http ? "http" : undefined;
    const value = file ?? command ?? http;
    if (!kind || !value) {
      logger.error("Usage: corral rules deny (--file GLOB | --command SUBSTRING | --http HOST)");
      process.exitCode = 1;
      return;
    }
    const rules = await loadRules();
    const rule: FirewallRule = {
      id: newRuleId(),
      enabled: true,
      action: "deny",
      scope: {
        ...(flag(rest, "--cwd") ? { cwdPrefix: flag(rest, "--cwd") as string } : {}),
        ...(flag(rest, "--session") ? { sessionId: flag(rest, "--session") as string } : {}),
      },
      match: { kind, value },
      createdAt: new Date().toISOString(),
    };
    rules.push(rule);
    await saveRules(rules);
    logger.success(`Denied: ${describeRule(rule)}`);
    return;
  }
  if (sub === "rm") {
    const id = rest[0];
    const rules = await loadRules();
    const next = rules.filter((r) => r.id !== id);
    if (next.length === rules.length) {
      logger.error(`Rule not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    await saveRules(next);
    logger.success(`Removed ${id}`);
    return;
  }
  logger.error("Usage: corral rules [list|deny (--file GLOB|--command STR|--http HOST)|rm ID]");
  process.exitCode = 1;
}
