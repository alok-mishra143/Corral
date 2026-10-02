import { execFile } from "node:child_process";
import { DEFAULT_PORT } from "../server/event-server.js";

export function parsePort(argv: string[]): number {
  let port = DEFAULT_PORT;
  const pi = argv.indexOf("--port");
  const eq = argv.find((a) => a.startsWith("--port="));
  const bare = argv.find((a) => /^\d{2,5}$/.test(a));
  if (pi >= 0 && argv[pi + 1] !== undefined) port = Number(argv[pi + 1]) || DEFAULT_PORT;
  else if (eq) port = Number(eq.split("=")[1]) || DEFAULT_PORT;
  else if (bare) port = Number(bare) || DEFAULT_PORT;
  return port;
}

export function listeningPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const pid = Number(stdout.trim().split("\n")[0]);
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null);
    });
  });
}

export async function waitGone(pid: number, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export type StopResult =
  | { status: "absent"; pid: null }
  | { status: "stopped" | "killed"; pid: number }
  | { status: "self" | "failed"; pid: number };

export async function stopDaemon(port: number): Promise<StopResult> {
  const pid = await listeningPid(port);
  if (!pid) return { status: "absent", pid: null };
  if (pid === process.pid) return { status: "self", pid };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { status: (await waitGone(pid, 1000)) ? "stopped" : "failed", pid };
  }
  if (await waitGone(pid)) return { status: "stopped", pid };
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  return { status: (await waitGone(pid)) ? "killed" : "failed", pid };
}
