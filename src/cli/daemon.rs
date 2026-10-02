use crate::cli::{ensure, process};
use crate::policy;
use crate::store::EventStore;
use crate::{error, info, success};
use std::sync::Arc;

fn port_owner(port: u16) -> Option<String> {
    let out = std::process::Command::new("lsof")
        .args(["-i", &format!(":{}", port), "-sTCP:LISTEN", "-F", "cp"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut pid = String::new();
    let mut name = String::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            pid = rest.to_string();
        }
        if let Some(rest) = line.strip_prefix('c') {
            name = rest.trim().to_string();
        }
    }
    if pid.is_empty() && name.is_empty() {
        None
    } else if pid.is_empty() {
        Some(name)
    } else if name.is_empty() {
        Some(format!("pid {}", pid))
    } else {
        Some(format!("{} (pid {})", name, pid))
    }
}

fn report_bind_failure(port: u16, err: &std::io::Error) -> i32 {
    if err.kind() != std::io::ErrorKind::AddrInUse {
        error!("Failed to start server on 127.0.0.1:{}: {}", port, err);
        return 1;
    }
    if let Some((status, _)) = ensure::http_get(port, "/health") {
        if status == 200 {
            let ours = ensure::http_get(port, "/api/agents")
                .map(|(_, body)| body.contains("\"agents\""))
                .unwrap_or(false);
            if ours {
                success!("Daemon already running on 127.0.0.1:{} — reusing it.", port);
                println!("Dashboard: http://127.0.0.1:{}/", port);
                return 0;
            }
            error!(
                "Port {} is already in use by another server (it answers /health).",
                port
            );
        } else {
            error!("Port {} is already in use (something listens there).", port);
        }
    } else {
        error!("Port {} is already in use (something listens there).", port);
    }
    if let Some(owner) = port_owner(port) {
        println!("  Occupied by: {}", owner);
    }
    println!("  Stop it, or run: corral daemon --port <free-port>");
    println!(
        "  Note: the OpenCode plugin posts to 127.0.0.1:{}, so a",
        crate::server::DEFAULT_PORT
    );
    println!("  different port also needs the plugin pointed at it.");
    1
}

pub fn run_daemon(argv: &[String]) -> i32 {
    let port = process::parse_port(argv);
    let store = Arc::new(EventStore::new(None));
    let server = match crate::server::create_server(port, "", store.clone()) {
        Ok(s) => s,
        Err(e) => return report_bind_failure(port, &e),
    };
    success!("Firewall server on 127.0.0.1:{}", server.port);
    info!(
        "Rules: {} | Events: {}",
        policy::default_rules_path().display(),
        store.path().display()
    );
    println!();
    println!(
        "Dashboard: http://127.0.0.1:{}/  (or run `corral admin`)",
        server.port
    );
    println!("Setup checklist:");
    println!("  1. corral setup                  # install the OpenCode plugin");
    println!("  2. restart OpenCode                  # so it loads the plugin");
    println!("  3. corral doctor                 # verify daemon + plugin + rules");
    println!();
    info!("Ctrl+C to stop.");
    loop {
        std::thread::park();
    }
}
