use serde_json::Value;
use std::os::windows::process::CommandExt;
use std::process::Command;

const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Open the OS-native file chooser and return the chosen path, or `None` when
/// the user cancels.
pub fn pick_file(prompt: &str) -> std::io::Result<Option<String>> {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         $d = New-Object System.Windows.Forms.OpenFileDialog; \
         $d.Title = '{}'; \
         if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($d.FileName) }}",
        prompt
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-STA", "-Command", &script])
        .output()?;
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
    let out = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH", "/FO", "CSV"])
        .output();
    let Ok(out) = out else {
        return false;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    text.contains(&format!("\"{}\"", pid))
}

/// End a process (Windows has no SIGTERM equivalent).
pub fn terminate(pid: i32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .output();
}

/// End a process forcibly.
pub fn force_kill(pid: i32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

/// Detach a spawned daemon from the console.
pub fn configure_detached(cmd: &mut Command) {
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

/// The pid listening on the TCP port, if any.
pub fn listening_pid(port: u16) -> Option<i32> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let suffix = format!(":{}", port);
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        if !fields[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !fields[3].eq_ignore_ascii_case("LISTENING") || !fields[1].ends_with(&suffix) {
            continue;
        }
        if let Ok(pid) = fields[4].parse::<i32>() {
            if pid > 0 {
                return Some(pid);
            }
        }
    }
    None
}

/// Running processes as (pid, ppid, command line).
pub fn process_rows() -> Vec<(i64, i64, String)> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();
    let Ok(out) = out else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return Vec::new();
    };
    let items: Vec<&Value> = match &value {
        Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    let mut rows = Vec::new();
    for item in items {
        let pid = item.get("ProcessId").and_then(|v| v.as_i64()).unwrap_or(0);
        let ppid = item
            .get("ParentProcessId")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let args = item
            .get("CommandLine")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if pid > 0 {
            rows.push((pid, ppid, args));
        }
    }
    rows
}
