import { spawn } from "node:child_process";
import { DEFAULT_PORT } from "../server/event-server.js";
export async function daemonHealthy(port: number = DEFAULT_PORT): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}
export async function ensureDaemon(port: number = DEFAULT_PORT): Promise<boolean> {
  if (await daemonHealthy(port)) return true;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const child = spawn(process.execPath, [entry, "daemon", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await daemonHealthy(port)) return true;
  }
  return false;
}
