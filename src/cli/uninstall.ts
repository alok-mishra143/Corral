import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { logger } from "../utils/logger.js";
import { globalOpencodePluginDir } from "./paths.js";
import { parsePort, stopDaemon } from "./process.js";

function hasFlag(argv: string[], ...names: string[]): boolean {
  return names.some((n) => argv.includes(n));
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function removePath(path: string): Promise<boolean> {
  if (!(await exists(path))) return false;
  await fs.rm(path, { recursive: true, force: true });
  return true;
}

const isYes = (answer: string): boolean => {
  const a = answer.trim().toLowerCase();
  return a === "yes" || a === "y";
};

interface Choices {
  removeData: boolean;
}

async function askChoices(keepData: boolean): Promise<Choices | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Uninstalling removes the daemon, the OpenCode plugin and the corral command.");
    const sure = await rl.question("Are you sure you want to uninstall corral? (yes/no) ");
    if (!isYes(sure)) return null;
    if (keepData) return { removeData: false };
    const remove = await rl.question(
      "Do you want to remove your saved settings and rules too? (yes/no) ",
    );
    return { removeData: isYes(remove) };
  } finally {
    rl.close();
  }
}

async function repoRoot(): Promise<string | null> {
  const entry = process.argv[1];
  if (!entry) return null;
  const root = dirname(dirname(entry));
  try {
    const pkg = JSON.parse(await fs.readFile(join(root, "package.json"), "utf8")) as { name?: unknown };
    return pkg.name === "corral" ? root : null;
  } catch {
    return null;
  }
}

export async function runUninstall(argv: string[]): Promise<void> {
  const yes = hasFlag(argv, "--yes", "-y");
  const keepData = argv.includes("--keep-data");
  const port = parsePort(argv);

  let removeData = !keepData;
  if (!yes) {
    if (!process.stdin.isTTY) {
      logger.error("Refusing to uninstall non-interactively. Re-run with --yes to confirm.");
      process.exitCode = 1;
      return;
    }
    const choices = await askChoices(keepData);
    if (!choices) {
      logger.info("Aborted — nothing was changed.");
      return;
    }
    removeData = choices.removeData;
  }

  let ok = true;
  const home = homedir();

  const stop = await stopDaemon(port);
  if (stop.status === "absent") {
    logger.info(`No daemon listening on :${port}.`);
  } else if (stop.status === "failed" || stop.status === "self") {
    logger.warn(`Could not stop the daemon on :${port} (pid ${stop.pid}) — stop it manually.`);
    ok = false;
  } else {
    logger.success(`Daemon on :${port} stopped (pid ${stop.pid}).`);
  }

  const plugin = join(globalOpencodePluginDir(), "corral.ts");
  try {
    if (await removePath(plugin)) logger.success(`Removed plugin ${plugin}`);
    else logger.info("Plugin was not installed.");
  } catch (err) {
    logger.warn("Could not remove plugin:", err instanceof Error ? err.message : err);
    ok = false;
  }

  const binDir = join(home, ".local", "bin");
  for (const bin of ["corral"]) {
    const p = join(binDir, bin);
    try {
      if (await removePath(p)) logger.success(`Removed command ${p}`);
    } catch (err) {
      logger.warn(`Could not remove ${p}:`, err instanceof Error ? err.message : err);
      ok = false;
    }
  }

  const dataDir = join(home, ".corral");
  if (!removeData) {
    logger.info(`Kept your settings and rules in ${dataDir} — a future install will reuse them.`);
  } else {
    try {
      if (await removePath(dataDir)) logger.success("Removed ~/.corral (rules, settings, events)");
    } catch (err) {
      logger.warn("Could not remove ~/.corral:", err instanceof Error ? err.message : err);
      ok = false;
    }
  }

  const repo = await repoRoot();
  console.log("");
  if (ok) logger.success("corral uninstalled.");
  else {
    logger.warn("corral partially uninstalled — see warnings above.");
    process.exitCode = 1;
  }
  if (repo) {
    console.log(`The repo checkout itself was kept: ${repo}`);
    console.log(`Remove it with: rm -rf "${repo}"`);
  }
  console.log("Restart OpenCode to unload the plugin if it is still running.");
}
