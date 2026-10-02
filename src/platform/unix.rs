use std::io;
use std::process::Command;

/// Open the OS-native file chooser and return the chosen path, or `None` when
/// the user cancels.
pub fn pick_file(prompt: &str) -> io::Result<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        return run_picker(
            "osascript",
            &["-e", &format!("POSIX path of (choose file with prompt \"{}\")", prompt)],
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        match run_picker("zenity", &["--file-selection", &format!("--title={}", prompt)]) {
            Ok(Some(path)) => Ok(Some(path)),
            Ok(None) => Ok(None),
            Err(_) => match run_picker("kdialog", &["--getopenfilename", ".", "*"]) {
                Ok(Some(path)) => Ok(Some(path)),
                Ok(None) => Ok(None),
                Err(_) => Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "no native file picker found (install zenity or kdialog)",
                )),
            },
        }
    }
}

fn run_picker(cmd: &str, args: &[&str]) -> io::Result<Option<String>> {
    let out = Command::new(cmd).args(args).output()?;
    if !out.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next().unwrap_or("").trim().to_string();
    if line.is_empty() {
        Ok(None)
    } else {
        Ok(Some(line))
    }
}

/// Whether a process with pid exists.
pub fn process_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Ask a process to exit (SIGTERM).
pub fn terminate(pid: i32) {
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
}

/// Force a process to exit (SIGKILL).
pub fn force_kill(pid: i32) {
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
}

/// Put a spawned daemon in its own session.
pub fn configure_detached(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
}

/// The pid listening on the TCP port, if any.
pub fn listening_pid(port: u16) -> Option<i32> {
    let out = Command::new("lsof")
        .args(["-ti", &format!("TCP:{}", port), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim();
    first.parse::<i32>().ok().filter(|p| *p > 0)
}

/// Running processes as (pid, ppid, command line).
pub fn process_rows() -> Vec<(i64, i64, String)> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,comm=,args="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.split('\n').filter_map(split_row).collect()
}

fn split_row(line: &str) -> Option<(i64, i64, String)> {
    let line = line.trim_start();
    let bytes = line.as_bytes();
    let mut idx = 0usize;
    let mut toks: Vec<(usize, usize)> = Vec::new();
    while idx < bytes.len() && toks.len() < 4 {
        while idx < bytes.len() && (bytes[idx] as char).is_whitespace() {
            idx += 1;
        }
        if idx >= bytes.len() {
            break;
        }
        let start = idx;
        while idx < bytes.len() && !(bytes[idx] as char).is_whitespace() {
            idx += 1;
        }
        toks.push((start, idx));
    }
    if toks.len() < 4 {
        return None;
    }
    let pid = line[toks[0].0..toks[0].1].parse::<i64>().ok()?;
    let ppid = line[toks[1].0..toks[1].1].parse::<i64>().ok()?;
    let args = line[toks[3].0..].to_string();
    Some((pid, ppid, args))
}
