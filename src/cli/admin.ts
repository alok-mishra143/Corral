import { spawn } from "node:child_process";
import { DEFAULT_PORT } from "../server/event-server.js";
import { ensureDaemon } from "./ensure.js";
import { logger } from "../utils/logger.js";

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "darwin" ? [url] : platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
  }
}

export async function runAdmin(argv: string[]): Promise<void> {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(get("--port") ?? DEFAULT_PORT) || DEFAULT_PORT;
  const noOpen = argv.includes("--no-open");
  const url = `http://127.0.0.1:${port}/`;
  await ensureDaemon(port);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error("unhealthy");
  } catch {
    logger.warn("Daemon does not seem to be running.");
    console.log(`  1. Start it:  corral daemon --port ${port}`);
    console.log(`  2. Then open: ${url}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Dashboard: ${url}`);
  if (!noOpen) {
    openBrowser(url);
    logger.success("Opening dashboard in your browser…");
  }
}
