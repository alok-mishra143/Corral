use crate::cli::process;
use crate::server::DEFAULT_PORT;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub fn http_get(port: u16, path: &str) -> Option<(u16, String)> {
    let addr = format!("127.0.0.1:{}", port).parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1500)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(1500)))
        .ok()?;
    let req = format!(
        "GET {} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n",
        path
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).ok()?;
    let status = buf
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())?;
    Some((status, buf))
}

pub fn daemon_healthy(port: u16) -> bool {
    http_get(port, "/health")
        .map(|(s, _)| s == 200)
        .unwrap_or(false)
}

pub fn ensure_daemon(port: u16) -> bool {
    let port = if port == 0 { DEFAULT_PORT } else { port };
    if daemon_healthy(port) {
        return true;
    }
    if process::spawn_daemon(port).is_none() {
        return false;
    }
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(250));
        if daemon_healthy(port) {
            return true;
        }
    }
    false
}
