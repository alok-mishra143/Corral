use crate::random;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RuleScope {
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(rename = "cwdPrefix", skip_serializing_if = "Option::is_none")]
    pub cwd_prefix: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RuleMatch {
    pub kind: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FirewallRule {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub enabled: bool,
    pub action: String,
    #[serde(default)]
    pub scope: RuleScope,
    #[serde(rename = "match")]
    pub match_: RuleMatch,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct RulesFile {
    version: u32,
    rules: Vec<FirewallRule>,
}

fn str_field(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub fn parse_rule(item: &Value) -> Option<FirewallRule> {
    let obj = item.as_object()?;
    let id = obj.get("id")?.as_str()?;
    if id.is_empty() || id.len() > 64 {
        return None;
    }
    let name = match obj.get("name") {
        None | Some(Value::Null) => None,
        Some(v) => {
            let s = v.as_str()?;
            if s.len() > 160 {
                return None;
            }
            Some(s.to_string())
        }
    };
    let m = obj.get("match")?.as_object()?;
    let kind = m.get("kind")?.as_str()?;
    if kind != "file" && kind != "command" && kind != "http" {
        return None;
    }
    let value = m.get("value")?.as_str()?;
    if value.is_empty() || value.len() > 1024 {
        return None;
    }
    let mut scope = RuleScope::default();
    if let Some(sv) = obj.get("scope") {
        if !sv.is_null() {
            let so = sv.as_object()?;
            if let Some(v) = so.get("sessionId") {
                if !v.is_null() {
                    let s = v.as_str()?;
                    if s.is_empty() || s.len() > 256 {
                        return None;
                    }
                    scope.session_id = Some(s.to_string());
                }
            }
            if let Some(v) = so.get("cwdPrefix") {
                if !v.is_null() {
                    let s = v.as_str()?;
                    if s.is_empty() || s.len() > 1024 {
                        return None;
                    }
                    scope.cwd_prefix = Some(s.to_string());
                }
            }
        }
    }
    let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let created_at = str_field(obj, "createdAt");
    Some(FirewallRule {
        id: id.to_string(),
        name,
        enabled,
        action: "deny".to_string(),
        scope,
        match_: RuleMatch {
            kind: kind.to_string(),
            value: value.to_string(),
        },
        created_at,
    })
}

pub fn default_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home).join(".corral")
}

pub fn default_rules_path() -> PathBuf {
    default_data_dir().join("rules.json")
}

pub fn default_settings_path() -> PathBuf {
    default_data_dir().join("settings.json")
}

pub fn load_rules(path: &Path) -> Vec<FirewallRule> {
    let Ok(data) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&data) else {
        return Vec::new();
    };
    let list = if let Some(arr) = parsed.as_array() {
        arr.clone()
    } else if let Some(rules) = parsed.get("rules").and_then(|v| v.as_array()) {
        rules.clone()
    } else {
        return Vec::new();
    };
    list.iter().filter_map(parse_rule).collect()
}

pub fn save_rules(rules: &[FirewallRule], path: &Path) -> std::io::Result<()> {
    let file = RulesFile {
        version: 1,
        rules: rules.to_vec(),
    };
    let mut text = serde_json::to_string_pretty(&file)?;
    text.push('\n');
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, text)
}

pub fn new_rule_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    format!("rule_{}_{}", base36(millis), random::random_hex(4))
}

/// Unique key for de-duplication: a rule's kind and value.
pub fn rule_key(rule: &FirewallRule) -> String {
    format!("{}\u{0}{}", rule.match_.kind, rule.match_.value)
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut s = Vec::new();
    while n > 0 {
        s.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

pub fn describe_rule(rule: &FirewallRule) -> String {
    let scope = if let Some(s) = &rule.scope.session_id {
        let id: String = s.chars().take(12).collect();
        format!("session {}…", id)
    } else if let Some(c) = &rule.scope.cwd_prefix {
        format!("project {}", c)
    } else {
        "all agents".to_string()
    };
    format!(
        "{}:{} → deny ({})",
        rule.match_.kind, rule.match_.value, scope
    )
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CorralSettings {
    #[serde(rename = "allowDashboardAccess")]
    pub allow_dashboard_access: bool,
}

pub fn normalize_settings(value: &Value) -> CorralSettings {
    let mut out = CorralSettings::default();
    if let Some(b) = value.get("allowDashboardAccess").and_then(|v| v.as_bool()) {
        out.allow_dashboard_access = b;
    }
    out
}

pub fn load_settings(path: &Path) -> CorralSettings {
    let Ok(data) = std::fs::read_to_string(path) else {
        return CorralSettings::default();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&data) else {
        return CorralSettings::default();
    };
    normalize_settings(&parsed)
}

pub fn save_settings(settings: &CorralSettings, path: &Path) -> std::io::Result<CorralSettings> {
    let normalized = normalize_settings(&serde_json::json!({
        "allowDashboardAccess": settings.allow_dashboard_access
    }));
    let mut text = serde_json::to_string_pretty(&normalized)?;
    text.push('\n');
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, text)?;
    Ok(normalized)
}
