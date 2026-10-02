use crate::cli::{ensure, process};
use crate::{success, warn};
use std::process::Command;

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/c", "start", "", url]);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    let _ = cmd.spawn();
}

pub fn run_admin(argv: &[String]) -> i32 {
    let port = process::parse_port(argv);
    let no_open = process::contains(argv, "--no-open");
    let url = format!("http://127.0.0.1:{}/", port);
    ensure::ensure_daemon(port);

    match ensure::http_get(port, "/health") {
        Some((200, _)) => {
            println!("Dashboard: {}", url);
            if !no_open {
                open_browser(&url);
                success!("Opening dashboard in your browser…");
            }
            0
        }
        _ => {
            warn!("Daemon does not seem to be running.");
            println!("  1. Start it:  corral daemon --port {}", port);
            println!("  2. Then open: {}", url);
            1
        }
    }
}
