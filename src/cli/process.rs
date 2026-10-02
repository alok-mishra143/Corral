use crate::platform;
use crate::server::DEFAULT_PORT;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn parse_port(argv: &[String]) -> u16 {
    for i in 0..argv.len() {
        if argv[i] == "--port" && i + 1 < argv.len() {
            if let Ok(n) = argv[i + 1].parse::<u16>() {
                return n;
            }
        }
    }
    for a in argv {
        if let Some(v) = a.strip_prefix("--port=") {
            if let Ok(n) = v.parse::<u16>() {
                return n;
            }
        }
    }
    for a in argv {
        if a.len() >= 2 && a.len() <= 5 && a.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(n) = a.parse::<u16>() {
                return n;
            }
        }
    }
    DEFAULT_PORT
}

pub fn contains(argv: &[String], flag: &str) -> bool {
    argv.iter().any(|a| a == flag)
}

pub fn listening_pid(port: u16) -> Option<i32> {
    platform::listening_pid(port)
}

pub fn wait_gone(pid: i32, ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(ms);
    while Instant::now() < deadline {
        if !platform::process_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

pub enum StopStatus {
    Absent,
    Stopped,
    Killed,
    SelfPid,
    Failed,
}

pub struct StopResult {
    pub status: StopStatus,
    pub pid: i32,
}

pub fn stop_daemon(port: u16) -> StopResult {
    let Some(pid) = listening_pid(port) else {
        return StopResult {
            status: StopStatus::Absent,
            pid: 0,
        };
    };
    if pid == std::process::id() as i32 {
        return StopResult {
            status: StopStatus::SelfPid,
            pid,
        };
    }
    platform::terminate(pid);
    if wait_gone(pid, 5000) {
        return StopResult {
            status: StopStatus::Stopped,
            pid,
        };
    }
    platform::force_kill(pid);
    if wait_gone(pid, 5000) {
        StopResult {
            status: StopStatus::Killed,
            pid,
        }
    } else {
        StopResult {
            status: StopStatus::Failed,
            pid,
        }
    }
}

pub fn spawn_daemon(port: u16) -> Option<u32> {
    let exe = std::env::current_exe().ok()?;
    let mut cmd = Command::new(exe);
    cmd.arg("daemon").arg("--port").arg(port.to_string());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    platform::configure_detached(&mut cmd);
    let child = cmd.spawn().ok()?;
    let pid = child.id();
    drop(child);
    Some(pid)
}
