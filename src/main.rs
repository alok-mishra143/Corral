mod cli;
mod events;
mod logger;
mod platform;
mod policy;
mod random;
mod scanner;
mod server;
mod store;
mod timeutil;

use std::process::exit;

const VERSION: &str = "0.2.0";

fn help() {
    println!("corral — restrict OpenCode agent file access via firewall rules");
    println!();
    println!("Usage: corral <command>");
    println!();
    println!("Commands:");
    println!("  d, admin [--port N] [--no-open]   Open the dashboard");
    println!("  daemon [--port N]                 Start the local firewall server");
    println!("  restart [--port N]                Restart the daemon (kills old, starts new)");
    println!("  uninstall [--yes] [--keep-data] [--port N]");
    println!("                                    Remove corral from this computer");
    println!("  setup                             Install the OpenCode plugin");
    println!("  rules list                        List firewall rules");
    println!("  rules deny --file GLOB            Deny agent access to a file glob");
    println!("  rules rm ID                       Remove a rule by id");
    println!("  doctor [--port N]                 Diagnose setup");
    println!("  version                           Print version");
    println!("  help                              Show this help");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
    let rest: &[String] = if args.len() > 1 { &args[1..] } else { &[] };

    let code = match cmd {
        "daemon" => cli::daemon::run_daemon(rest),
        "restart" => cli::restart::run_restart(rest),
        "uninstall" => cli::uninstall::run_uninstall(rest),
        "setup" => cli::setup::run_setup(),
        "rules" => cli::rules::run_rules(rest),
        "d" | "dashboard" | "admin" => cli::admin::run_admin(rest),
        "doctor" => cli::doctor::run_doctor(rest),
        "help" | "--help" | "-h" => {
            help();
            0
        }
        "version" => {
            println!("corral v{}", VERSION);
            0
        }
        _ => {
            help();
            if cmd.is_empty() {
                1
            } else {
                0
            }
        }
    };
    exit(code);
}
