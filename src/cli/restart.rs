use crate::cli::{ensure, process};
use crate::platform;
use crate::{error, info, success};
use std::time::Duration;

pub fn run_restart(argv: &[String]) -> i32 {
    let port = process::parse_port(argv);

    if let Some(pid) = process::listening_pid(port) {
        if pid == std::process::id() as i32 {
            error!("Refusing to kill our own process.");
            return 1;
        }
        info!("Stopping old daemon on :{} (pid {})…", port, pid);
        platform::terminate(pid);
        if !process::wait_gone(pid, 5000) {
            info!("pid {} did not exit, killing it…", pid);
            platform::force_kill(pid);
            if !process::wait_gone(pid, 5000) {
                error!("pid {} is still alive — kill it manually and retry.", pid);
                return 1;
            }
        }
        success!("Old daemon (pid {}) stopped.", pid);
    } else {
        info!("Nothing listening on :{} — starting fresh.", port);
    }

    let Some(pid) = process::spawn_daemon(port) else {
        error!("Could not spawn daemon.");
        return 1;
    };
    for _ in 0..25 {
        std::thread::sleep(Duration::from_millis(200));
        if ensure::daemon_healthy(port) {
            success!("Daemon restarted on 127.0.0.1:{} (pid {}).", port, pid);
            println!("Dashboard: http://127.0.0.1:{}/", port);
            return 0;
        }
    }
    error!("Daemon was spawned but /health is not answering — check logs.");
    1
}
