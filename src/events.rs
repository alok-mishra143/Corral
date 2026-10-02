use crate::timeutil::valid_timestamp;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const OPENCODE: &str = "opencode";

pub const TYPES: &[&str] = &[
    "session.started",
    "session.stopped",
    "session.idle",
    "tool.started",
    "tool.completed",
    "file.read",
    "file.edited",
    "file.created",
    "file.deleted",
    "command.executed",
    "http.request",
    "http.response",
    "permission.requested",
    "error",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Agent {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentEvent {
    pub id: String,
    pub timestamp: String,
    pub agent: Agent,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub data: Map<String, Value>,
}

const SENSITIVE: &[&str] = &[
    "apikey",
    "api_key",
    "api-key",
    "authorization",
    "auth",
    "bearer",
    "token",
    "secret",
    "cookie",
    "password",
    "passwd",
    "private_key",
    "private-key",
    "client_secret",
    "client-secret",
    "session_key",
    "session-key",
];

const SENSITIVE_PARAM: &[&str] = &[
    "key", "token", "secret", "auth", "session", "code", "password",
];

fn key_sensitive(key: &str) -> bool {
    let l = key.to_lowercase();
    SENSITIVE.iter().any(|s| l.contains(s))
}

fn param_sensitive(key: &str) -> bool {
    let l = key.to_lowercase();
    SENSITIVE_PARAM.iter().any(|s| l.contains(s))
}

fn int_value(v: &Value) -> Option<i64> {
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    if let Some(f) = v.as_f64() {
        if f.fract() == 0.0 && f > 0.0 && f <= i64::MAX as f64 {
            return Some(f as i64);
        }
    }
    None
}

pub fn parse_event(input: &Value) -> Option<AgentEvent> {
    let obj = input.as_object()?;
    let id = obj.get("id")?.as_str()?;
    if id.is_empty() || id.len() > 128 {
        return None;
    }
    let timestamp = obj.get("timestamp")?.as_str()?;
    if !valid_timestamp(timestamp) {
        return None;
    }
    let agent_obj = obj.get("agent")?.as_object()?;
    if agent_obj.get("name")?.as_str()? != OPENCODE {
        return None;
    }
    let pid = match agent_obj.get("pid") {
        None | Some(Value::Null) => None,
        Some(v) => {
            let n = int_value(v)?;
            if n <= 0 {
                return None;
            }
            Some(n)
        }
    };
    let session_id = match agent_obj.get("sessionId") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_str()?.to_string()),
    };
    let event_type = obj.get("type")?.as_str()?.to_string();
    if !TYPES.contains(&event_type.as_str()) {
        return None;
    }
    let cwd = match obj.get("cwd") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_str()?.to_string()),
    };
    let data = obj.get("data")?.as_object()?;
    let redacted = match redact_unknown(&Value::Object(data.clone())) {
        Value::Object(m) => m,
        _ => data.clone(),
    };
    Some(AgentEvent {
        id: id.to_string(),
        timestamp: timestamp.to_string(),
        agent: Agent {
            name: OPENCODE.to_string(),
            pid,
            session_id,
        },
        event_type,
        cwd,
        data: redacted,
    })
}

pub fn redact_unknown(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(redact_unknown).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                let lower = k.to_lowercase();
                if lower == "headers" {
                    if let Some(headers) = v.as_object() {
                        let mut h = Map::new();
                        for (hk, hv) in headers {
                            if key_sensitive(hk) {
                                h.insert(hk.clone(), Value::String("[REDACTED]".into()));
                            } else {
                                h.insert(hk.clone(), redact_unknown(hv));
                            }
                        }
                        out.insert(k.clone(), Value::Object(h));
                        continue;
                    }
                }
                if lower == "url" {
                    if let Some(s) = v.as_str() {
                        out.insert(k.clone(), Value::String(redact_url(s)));
                        continue;
                    }
                }
                if key_sensitive(k) {
                    out.insert(k.clone(), Value::String("[REDACTED]".into()));
                } else {
                    out.insert(k.clone(), redact_unknown(v));
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

pub fn redact_url(raw: &str) -> String {
    let Some(qpos) = raw.find('?') else {
        return raw.to_string();
    };
    let (base, query) = raw.split_at(qpos + 1);
    let mut changed = false;
    let mut parts: Vec<String> = Vec::new();
    for pair in query.split('&') {
        if let Some((k, _v)) = pair.split_once('=') {
            if param_sensitive(k) {
                parts.push(format!("{}={}", k, "[REDACTED]"));
                changed = true;
                continue;
            }
        }
        parts.push(pair.to_string());
    }
    if !changed {
        return raw.to_string();
    }
    format!("{}{}", base, parts.join("&"))
}
