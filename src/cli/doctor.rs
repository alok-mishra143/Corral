use crate::cli::{ensure, paths, process};
use crate::policy;
use crate::{error, success};

pub fn run_doctor(argv: &[String]) -> i32 {
    let port = process::parse_port(argv);
    let mut ok = true;

    if ensure::daemon_healthy(port) {
        success!("daemon reachable at 127.0.0.1:{}", port);
    } else {
        error!(
            "daemon NOT reachable at 127.0.0.1:{} — run `corral daemon`",
            port
        );
        ok = false;
    }

    let plugin = paths::global_opencode_plugin_dir().join("corral.ts");
    match std::fs::read_to_string(&plugin) {
        Ok(content) if content.contains("CorralPlugin") => {
            success!("OpenCode plugin installed ({})", plugin.display());
        }
        _ => {
            error!("OpenCode plugin missing — run `corral setup`");
            ok = false;
        }
    }

    let rules = policy::load_rules(&policy::default_rules_path());
    let enabled = rules.iter().filter(|r| r.enabled).count();
    success!(
        "rules readable ({} total, {} enabled)",
        rules.len(),
        enabled
    );

    if !ok {
        println!("\nFix: run `corral setup`, then `corral daemon`, then restart OpenCode.");
        return 1;
    }
    0
}
