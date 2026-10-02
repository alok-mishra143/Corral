import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { findIntegrationsDir, globalOpencodePluginDir } from "./paths.js";

export async function runSetup(): Promise<void> {
  const templateDir = await findIntegrationsDir();
  if (!templateDir) {
    logger.error("Could not locate the integrations templates. Run from the corral repo or reinstall.");
    process.exitCode = 1;
    return;
  }
  try {
    const src = join(templateDir, "opencode", "plugin.ts");
    const destDir = globalOpencodePluginDir();
    const content = await fs.readFile(src, "utf8");
    if (!content.includes("CorralPlugin")) throw new Error(`unexpected plugin template at ${src}`);
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(join(destDir, "corral.ts"), content, "utf8");
    logger.success(`OpenCode plugin installed → ${join(destDir, "corral.ts")}`);
  } catch (err) {
    logger.error("Setup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. corral daemon               # must be running to enforce rules");
  console.log("  2. restart OpenCode                # so it loads the plugin");
  console.log("  3. corral rules deny --file '**/.env*'");
  console.log("  4. corral doctor               # verify everything");
}
