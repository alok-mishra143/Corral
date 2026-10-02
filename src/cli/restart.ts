import { spawn } from "node:child_process";
import { logger } from "../utils/logger.js";
import { listeningPid, parsePort, waitGone } from "./process.js";

export async function runRestart(argv: string[]): Promise<void> {
  const port = parsePort(argv);
  const pid = await listeningPid(port);
  if (pid) {
    if (pid === process.pid) {
      logger.error("Refusing to kill our own process.");
      process.exitCode = 1;
      return;
    }
    logger.info(`Stopping old daemon on :${port} (pid ${pid})…`);
    try {
      process.kill(pid, "SIGTERM");
    } catch (err) {
      logger.error(`Could not signal pid ${pid}:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }
    if (!(await waitGone(pid))) {
      logger.info(`pid ${pid} did not exit, sending SIGKILL…`);
      try {
        process.kill(pid, "SIGKILL");
      } catch { /* already gone */ }
      if (!(await waitGone(pid))) {
        logger.error(`pid ${pid} is still alive — kill it manually and retry.`);
        process.exitCode = 1;
        return;
      }
    }
    logger.success(`Old daemon (pid ${pid}) stopped.`);
  } else {
    logger.info(`Nothing listening on :${port} — starting fresh.`);
  }
  const child = spawn(process.execPath, [process.argv[1] ?? "", "daemon", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const h = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (h.ok) {
        logger.success(`Daemon restarted on 127.0.0.1:${port} (pid ${child.pid}).`);
        console.log(`Dashboard: http://127.0.0.1:${port}/`);
        return;
      }
    } catch { /* not up yet */ }
  }
  logger.error("Daemon was spawned but /health is not answering — check logs.");
  process.exitCode = 1;
}
