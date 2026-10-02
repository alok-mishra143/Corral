import { runAdmin } from "./cli/admin.js";
import { runDaemon } from "./cli/daemon.js";
import { runDoctor } from "./cli/doctor.js";
import { runRestart } from "./cli/restart.js";
import { runRules } from "./cli/rules.js";
import { runSetup } from "./cli/setup.js";
import { runUninstall } from "./cli/uninstall.js";

export const VERSION = "0.2.0";

function help(): void {
  console.log("corral — restrict OpenCode agent file access via firewall rules");
  console.log("");
  console.log("Usage: corral <command>");
  console.log("");
  console.log("Commands:");
  console.log("  d, admin [--port N] [--no-open]   Open the dashboard");
  console.log("  daemon [--port N]                 Start the local firewall server");
  console.log("  restart [--port N]                Restart the daemon (kills old, starts new)");
  console.log("  uninstall [--yes] [--keep-data] [--port N]");
  console.log("                                    Remove corral from this computer");
  console.log("  setup                             Install the OpenCode plugin");
  console.log("  rules list                        List firewall rules");
  console.log("  rules deny --file GLOB            Deny agent access to a file glob");
  console.log("  rules rm ID                       Remove a rule by id");
  console.log("  doctor [--port N]                 Diagnose setup");
  console.log("  version                           Print version");
  console.log("  help                              Show this help");
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "daemon": await runDaemon(rest); break;
    case "restart": await runRestart(rest); break;
    case "uninstall": await runUninstall(rest); break;
    case "setup": await runSetup(); break;
    case "rules": await runRules(rest); break;
    case "d":
    case "dashboard":
    case "admin": await runAdmin(rest); break;
    case "doctor": await runDoctor(rest); break;
    case "help": help(); break;
    case "version": console.log(`corral v${VERSION}`); break;
    default: help(); if (!cmd) process.exitCode = 1; break;
  }
}

await main();
