use crate::events::AgentEvent;
use crate::platform;
use crate::policy;
use crate::random;
use crate::scanner::{scan_agents, RunningAgent};
use crate::store::EventStore;
use crate::timeutil;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 4317;
pub const DEFAULT_HOST: &str = "127.0.0.1";
const MAX_BODY_BYTES: usize = 1024 * 1024;
const UI_TOKEN_HEADER: &str = "x-corral-ui";
const AGENTS_CACHE_TTL: Duration = Duration::from_secs(10);

const DASHBOARD_HTML: &str = include_str!("dashboard.html");
const TOKEN_PLACEHOLDER: &str = "var AG_UI_TOKEN = \"\";";

pub struct State {
    pub store: Arc<EventStore>,
    pub ui_token: String,
    agents_cache: Mutex<Option<(Instant, Vec<RunningAgent>)>>,
}

pub struct Server {
    pub port: u16,
}

pub fn create_server(port: u16, host: &str, store: Arc<EventStore>) -> std::io::Result<Server> {
    let host = if host.is_empty() { DEFAULT_HOST } else { host };
    if host != "127.0.0.1" && host != "::1" && host != "localhost" {
        return Err(std::io::Error::other(format!(
            "refusing to bind event server to non-loopback host: {}",
            host
        )));
    }
    let listener = TcpListener::bind((host, port))?;
    let state = Arc::new(State {
        store,
        ui_token: random::random_hex(24),
        agents_cache: Mutex::new(None),
    });
    let st = state.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let st = st.clone();
                    std::thread::spawn(move || {
                        let _ = handle_conn(s, &st);
                    });
                }
                Err(_) => break,
            }
        }
    });
    Ok(Server { port })
}

fn cached_agents(state: &State) -> Vec<RunningAgent> {
    let mut cache = state.agents_cache.lock().unwrap();
    if let Some((at, value)) = &*cache {
        if at.elapsed() < AGENTS_CACHE_TTL {
            return value.clone();
        }
    }
    let value = scan_agents();
    *cache = Some((Instant::now(), value.clone()));
    value
}

struct Request {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    too_large: bool,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
    fn token_ok(&self, state: &State) -> bool {
        self.header(UI_TOKEN_HEADER) == Some(state.ui_token.as_str())
    }
}

fn read_request(stream: &TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut it = line.split_whitespace();
    let method = it.next()?.to_string();
    let target = it.next().unwrap_or("/").to_string();
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        let n = reader.read_line(&mut h).ok()?;
        if n == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.push((k.trim().to_lowercase(), v.trim().to_string()));
        }
    }
    let clen = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    if clen > MAX_BODY_BYTES {
        return Some(Request {
            method,
            path,
            query,
            headers,
            body: Vec::new(),
            too_large: true,
        });
    }
    let mut body = vec![0u8; clen];
    let mut read = 0usize;
    while read < clen {
        match reader.read(&mut body[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => break,
        }
    }
    body.truncate(read);
    Some(Request {
        method,
        path,
        query,
        headers,
        body,
        too_large: false,
    })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn respond(stream: &mut TcpStream, status: u16, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: {}\r\ncontent-length: {}\r\ncache-control: no-store\r\nconnection: close\r\n\r\n",
        status,
        reason(status),
        ctype,
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_json(stream: &mut TcpStream, status: u16, value: &Value) {
    let body = serde_json::to_vec(value).unwrap_or_default();
    respond(stream, status, "application/json", &body);
}

fn send_html(stream: &mut TcpStream, status: u16, html: &str) {
    respond(stream, status, "text/html; charset=utf-8", html.as_bytes());
}

fn read_json_body(req: &Request) -> Result<Value, (u16, &'static str)> {
    serde_json::from_slice::<Value>(&req.body).map_err(|_| (400, "malformed JSON"))
}

fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|s| !s.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((k, v)) => (percent_decode(k), percent_decode(v)),
            None => (percent_decode(pair), String::new()),
        })
        .collect()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(n) = u8::from_str_radix(hex, 16) {
                out.push(n);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn get_query<'a>(q: &'a [(String, String)], key: &str) -> Option<&'a str> {
    q.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn handle_conn(mut stream: TcpStream, state: &State) -> std::io::Result<()> {
    let Some(req) = read_request(&stream) else {
        return Ok(());
    };
    if req.too_large {
        send_json(
            &mut stream,
            413,
            &json!({"ok": false, "error": "payload too large"}),
        );
        return Ok(());
    }
    route(&mut stream, state, &req)
}

fn route(stream: &mut TcpStream, state: &State, req: &Request) -> std::io::Result<()> {
    let path = req.path.as_str();
    let method = req.method.as_str();

    if path == "/health" && method == "GET" {
        send_json(stream, 200, &json!({"ok": true}));
        return Ok(());
    }

    if method == "GET" && (path == "/" || path == "/admin") {
        let token_json = serde_json::to_string(&state.ui_token).unwrap_or_else(|_| "\"\"".into());
        let html = DASHBOARD_HTML.replacen(
            TOKEN_PLACEHOLDER,
            &format!("var AG_UI_TOKEN = {};", token_json),
            1,
        );
        send_html(stream, 200, &html);
        return Ok(());
    }

    if path == "/api/settings" && (method == "GET" || method == "PUT") {
        return handle_settings(stream, state, req, method);
    }

    if path == "/api/agents" && method == "GET" {
        send_json(stream, 200, &json!({"agents": cached_agents(state)}));
        return Ok(());
    }

    if path.starts_with("/api/agents/") && path.ends_with("/kill") && method == "POST" {
        return handle_kill(stream, state, req, path);
    }

    if path == "/api/rules" && method == "GET" {
        let rules = policy::load_rules(&policy::default_rules_path());
        send_json(stream, 200, &json!({"rules": rules}));
        return Ok(());
    }

    if path == "/api/rules" && method == "POST" {
        return handle_rule_create(stream, state, req);
    }

    if path.starts_with("/api/rules/") && (method == "PUT" || method == "DELETE") {
        return handle_rule_update(stream, state, req, path, method);
    }

    if path == "/api/pick-file" && method == "POST" {
        return handle_pick_file(stream, state, req);
    }

    if path == "/api/events" && method == "GET" {
        return handle_events(stream, state, req);
    }

    if path != "/events" {
        send_json(stream, 404, &json!({"ok": false, "error": "not found"}));
        return Ok(());
    }

    if method != "POST" {
        send_json(
            stream,
            405,
            &json!({"ok": false, "error": "method not allowed"}),
        );
        return Ok(());
    }

    match serde_json::from_slice::<Value>(&req.body) {
        Err(_) => {
            send_json(
                stream,
                400,
                &json!({"ok": false, "error": "malformed JSON"}),
            );
            Ok(())
        }
        Ok(value) => match state.store.append(&value) {
            None => {
                send_json(
                    stream,
                    400,
                    &json!({"ok": false, "error": "invalid event payload"}),
                );
                Ok(())
            }
            Some(event) => {
                send_json(stream, 202, &json!({"ok": true, "id": event.id}));
                Ok(())
            }
        },
    }
}

fn handle_settings(
    stream: &mut TcpStream,
    state: &State,
    req: &Request,
    method: &str,
) -> std::io::Result<()> {
    if method == "PUT" && !req.token_ok(state) {
        send_json(
            stream,
            403,
            &json!({"ok": false, "error": "dashboard UI token required"}),
        );
        return Ok(());
    }
    if method == "GET" {
        let settings = policy::load_settings(&policy::default_settings_path());
        send_json(stream, 200, &json!({"settings": settings}));
        return Ok(());
    }
    let value = match read_json_body(req) {
        Err((s, e)) => {
            send_json(stream, s, &json!({"ok": false, "error": e}));
            return Ok(());
        }
        Ok(v) => v,
    };
    let settings = policy::normalize_settings(&value);
    match policy::save_settings(&settings, &policy::default_settings_path()) {
        Ok(saved) => send_json(stream, 200, &json!({"ok": true, "settings": saved})),
        Err(_) => send_json(
            stream,
            500,
            &json!({"ok": false, "error": "internal error"}),
        ),
    }
    Ok(())
}

fn handle_pick_file(
    stream: &mut TcpStream,
    state: &State,
    req: &Request,
) -> std::io::Result<()> {
    if !req.token_ok(state) {
        send_json(
            stream,
            403,
            &json!({"ok": false, "error": "dashboard UI token required"}),
        );
        return Ok(());
    }
    match platform::pick_file("Select a file for corral to exclude") {
        Ok(Some(path)) => send_json(stream, 200, &json!({"ok": true, "path": path})),
        Ok(None) => send_json(stream, 200, &json!({"ok": false, "canceled": true})),
        Err(e) => send_json(stream, 500, &json!({"ok": false, "error": e.to_string()})),
    }
    Ok(())
}

fn handle_kill(
    stream: &mut TcpStream,
    state: &State,
    req: &Request,
    path: &str,
) -> std::io::Result<()> {
    if !req.token_ok(state) {
        send_json(
            stream,
            403,
            &json!({"ok": false, "error": "dashboard UI token required"}),
        );
        return Ok(());
    }
    let pid_raw = path
        .trim_start_matches("/api/agents/")
        .trim_end_matches("/kill");
    let pid = pid_raw.parse::<i32>().ok();
    let our_pid = std::process::id() as i32;
    let Some(pid) = pid else {
        send_json(stream, 400, &json!({"ok": false, "error": "invalid pid"}));
        return Ok(());
    };
    if pid <= 1 || pid == our_pid {
        send_json(stream, 400, &json!({"ok": false, "error": "invalid pid"}));
        return Ok(());
    }
    if !scan_agents().iter().any(|a| a.pid == pid as i64) {
        send_json(
            stream,
            404,
            &json!({"ok": false, "error": "pid is not a detected agent"}),
        );
        return Ok(());
    }
    if !platform::process_alive(pid) {
        send_json(
            stream,
            404,
            &json!({"ok": false, "error": "process already gone or permission denied"}),
        );
        return Ok(());
    }
    platform::terminate(pid);
    send_json(
        stream,
        200,
        &json!({"ok": true, "pid": pid, "signal": "SIGTERM"}),
    );
    Ok(())
}

fn handle_rule_create(stream: &mut TcpStream, state: &State, req: &Request) -> std::io::Result<()> {
    if !req.token_ok(state) {
        send_json(
            stream,
            403,
            &json!({"ok": false, "error": "dashboard UI token required"}),
        );
        return Ok(());
    }
    let mut value = match read_json_body(req) {
        Err((s, e)) => {
            send_json(stream, s, &json!({"ok": false, "error": e}));
            return Ok(());
        }
        Ok(v) => v,
    };
    if !value.is_object() {
        value = json!({});
    }
    let obj = value.as_object_mut().unwrap();
    if !obj.contains_key("id") || obj.get("id").map(|v| v.is_null()).unwrap_or(false) {
        obj.insert("id".into(), json!(policy::new_rule_id()));
    }
    obj.insert("createdAt".into(), json!(timeutil::now_iso()));
    let Some(rule) = policy::parse_rule(&Value::Object(obj.clone())) else {
        send_json(stream, 400, &json!({"ok": false, "error": "invalid rule"}));
        return Ok(());
    };
    let mut rules = policy::load_rules(&policy::default_rules_path());
    let key = policy::rule_key(&rule);
    if let Some(existing) = rules.iter().find(|r| policy::rule_key(r) == key) {
        send_json(
            stream,
            200,
            &json!({"ok": true, "rule": existing, "duplicate": true}),
        );
        return Ok(());
    }
    rules.push(rule.clone());
    match policy::save_rules(&rules, &policy::default_rules_path()) {
        Ok(_) => send_json(stream, 201, &json!({"ok": true, "rule": rule})),
        Err(_) => send_json(
            stream,
            500,
            &json!({"ok": false, "error": "internal error"}),
        ),
    }
    Ok(())
}

fn handle_rule_update(
    stream: &mut TcpStream,
    state: &State,
    req: &Request,
    path: &str,
    method: &str,
) -> std::io::Result<()> {
    if !req.token_ok(state) {
        send_json(
            stream,
            403,
            &json!({"ok": false, "error": "dashboard UI token required"}),
        );
        return Ok(());
    }
    let id = percent_decode(path.trim_start_matches("/api/rules/"));
    let mut rules = policy::load_rules(&policy::default_rules_path());
    let Some(idx) = rules.iter().position(|r| r.id == id) else {
        send_json(
            stream,
            404,
            &json!({"ok": false, "error": "rule not found"}),
        );
        return Ok(());
    };
    if method == "DELETE" {
        rules.remove(idx);
        match policy::save_rules(&rules, &policy::default_rules_path()) {
            Ok(_) => send_json(stream, 200, &json!({"ok": true})),
            Err(_) => send_json(
                stream,
                500,
                &json!({"ok": false, "error": "internal error"}),
            ),
        }
        return Ok(());
    }
    let mut value = match read_json_body(req) {
        Err((s, e)) => {
            send_json(stream, s, &json!({"ok": false, "error": e}));
            return Ok(());
        }
        Ok(v) => v,
    };
    if !value.is_object() {
        value = json!({});
    }
    value
        .as_object_mut()
        .unwrap()
        .insert("id".into(), json!(id));
    let Some(rule) = policy::parse_rule(&value) else {
        send_json(stream, 400, &json!({"ok": false, "error": "invalid rule"}));
        return Ok(());
    };
    rules[idx] = rule.clone();
    match policy::save_rules(&rules, &policy::default_rules_path()) {
        Ok(_) => send_json(stream, 200, &json!({"ok": true, "rule": rule})),
        Err(_) => send_json(
            stream,
            500,
            &json!({"ok": false, "error": "internal error"}),
        ),
    }
    Ok(())
}

fn handle_events(stream: &mut TcpStream, state: &State, req: &Request) -> std::io::Result<()> {
    let q = parse_query(&req.query);
    let limit = get_query(&q, "limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 500);
    let pid = get_query(&q, "pid").and_then(|v| v.parse::<i64>().ok());
    let has_pid = pid.map(|p| p > 0).unwrap_or(false);
    let session = get_query(&q, "session").unwrap_or("").to_string();
    let agent = get_query(&q, "agent").unwrap_or("").to_lowercase();
    let filter = move |e: &AgentEvent| -> bool {
        if has_pid && e.agent.pid != pid {
            return false;
        }
        if !session.is_empty() && e.agent.session_id.as_deref() != Some(session.as_str()) {
            return false;
        }
        if !agent.is_empty() && e.agent.name.to_lowercase() != agent {
            return false;
        }
        true
    };
    let events = state.store.read_tail(limit, Some(&filter));
    send_json(stream, 200, &json!({ "events": events }));
    Ok(())
}
