import { execFile } from "node:child_process";
import { createEventServer, DEFAULT_PORT } from "../server/event-server.js";
import { EventStore } from "../events/store.js";
import { defaultRulesPath } from "../policy/rules.js";
import { logger } from "../utils/logger.js";

function portOwner(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("lsof", ["-i", `:${port}`, "-sTCP:LISTEN", "-F", "cp"], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const pid = stdout.match(/^p(\d+)$/m)?.[1];
      const cmd = stdout.match(/^c(.+)$/m)?.[1]?.trim();
      if (pid && cmd) resolve(`${cmd} (pid ${pid})`);
      else if (pid) resolve(`pid ${pid}`);
      else resolve(cmd ?? null);
    });
  });
}

async function reportBindFailure(port: number, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown })?.code;
  if (code !== "EADDRINUSE" && !/address already in use|in use/i.test(msg)) {
    logger.error(`Failed to start server on 127.0.0.1:${port}: ${msg}`);
    process.exitCode = 1;
    return;
  }
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (health.ok) {
      let ours = false;
      try {
        const j = (await (
          await fetch(`http://127.0.0.1:${port}/api/agents`, { signal: AbortSignal.timeout(2000) })
        ).json()) as { agents?: unknown };
        ours = Array.isArray(j?.agents);
      } catch {
      }
      if (ours) {
        logger.success(`Daemon already running on 127.0.0.1:${port} — reusing it.`);
        console.log(`Dashboard: http://127.0.0.1:${port}/`);
        return;
      }
      logger.error(`Port ${port} is already in use by another server (it answers /health).`);
    } else {
      logger.error(`Port ${port} is already in use (something listens there).`);
    }
  } catch {
    logger.error(`Port ${port} is already in use.`);
  }
  const owner = await portOwner(port);
  if (owner) console.log(`  Occupied by: ${owner}`);
  console.log(`  Stop it, or run: corral daemon --port <free-port>`);
  console.log(`  Note: the OpenCode plugin posts to 127.0.0.1:${DEFAULT_PORT}, so a`);
  console.log(`  different port also needs the plugin pointed at it.`);
  process.exitCode = 1;
}

export async function runDaemon(argv: string[]): Promise<void> {
  let port = DEFAULT_PORT;
  const pi = argv.indexOf("--port");
  const eq = argv.find((a) => a.startsWith("--port="));
  const bare = argv.find((a) => /^\d{2,5}$/.test(a));
  if (pi >= 0 && argv[pi + 1] !== undefined) port = Number(argv[pi + 1]) || DEFAULT_PORT;
  else if (eq) port = Number(eq.split("=")[1]) || DEFAULT_PORT;
  else if (bare) port = Number(bare) || DEFAULT_PORT;
  const store = new EventStore();
  let server;
  try {
    server = await createEventServer({ port, store });
  } catch (err) {
    await reportBindFailure(port, err);
    return;
  }
  logger.success(`Firewall server on 127.0.0.1:${server.port}`);
  logger.info(`Rules: ${defaultRulesPath()} | Events: ${store.path}`);
  console.log("");
  console.log(`Dashboard: http://127.0.0.1:${server.port}/  (or run \`corral admin\`)`);
  console.log("Setup checklist:");
  console.log("  1. corral setup                  # install the OpenCode plugin");
  console.log("  2. restart OpenCode                # so it loads the plugin");
  console.log("  3. corral doctor                 # verify daemon + plugin + rules");
  console.log("");
  logger.info("Ctrl+C to stop.");
  let running = true;
  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;
    try {
      await server.close();
    } catch {
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => setTimeout(() => process.exit(0), 1500).unref());
  await new Promise(() => {});
}
