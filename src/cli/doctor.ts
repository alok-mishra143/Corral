import { promises as fs } from "node:fs";
import { join } from "node:path";
import { loadRules } from "../policy/rules.js";
import { logger } from "../utils/logger.js";
import { globalOpencodePluginDir } from "./paths.js";
import { DEFAULT_PORT } from "../server/event-server.js";

export async function runDoctor(argv: string[]): Promise<void> {
  const pi = argv.indexOf("--port");
  const port = Number(pi >= 0 ? argv[pi + 1] : DEFAULT_PORT) || DEFAULT_PORT;
  let ok = true;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) logger.success(`daemon reachable at 127.0.0.1:${port}`);
    else throw new Error("unhealthy");
  } catch {
    logger.error(`daemon NOT reachable at 127.0.0.1:${port} — run \`corral daemon\``);
    ok = false;
  }
  const pluginPath = join(globalOpencodePluginDir(), "corral.ts");
  try {
    const content = await fs.readFile(pluginPath, "utf8");
    if (content.includes("CorralPlugin")) logger.success(`OpenCode plugin installed (${pluginPath})`);
    else throw new Error("foreign");
  } catch {
    logger.error("OpenCode plugin missing — run `corral setup`");
    ok = false;
  }
  try {
    const rules = await loadRules();
    logger.success(`rules readable (${rules.length} total, ${rules.filter((r) => r.enabled).length} enabled)`);
  } catch (err) {
    logger.error("rules unreadable:", err instanceof Error ? err.message : err);
    ok = false;
  }
  if (!ok) {
    process.exitCode = 1;
    console.log("\nFix: run `corral setup`, then `corral daemon`, then restart OpenCode.");
  }
}
