use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone, Debug)]
pub struct RunningAgent {
    pub name: String,
    pub pid: i64,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ide: Option<String>,
}

const IDE_MARKERS: &[(&str, &[&str])] = &[
    (
        "VS Code",
        &["visual studio code.app", "vscodium", "/code", "code-oss"],
    ),
    ("Zed", &["zed.app", "zed"]),
    ("Cursor", &["cursor.app", "cursor"]),
    ("Windsurf", &["windsurf.app", "windsurf"]),
    (
        "JetBrains",
        &[
            "intellij",
            "webstorm",
            "pycharm",
            "goland",
            "phpstorm",
            "clion",
            "rider",
            "android studio",
        ],
    ),
    ("Xcode", &["xcode.app", "xcodebuild"]),
    ("Sublime", &["sublime text.app", "subl"]),
    ("Vim", &["/vim ", " vim ", "vim "]),
    ("Neovim", &["nvim"]),
    (
        "Terminal",
        &[
            "terminal.app",
            "iterm",
            "ghostty",
            "alacritty",
            "kitty",
            "wezterm",
            "tmux",
        ],
    ),
];

const NOISE: &[&str] = &[
    "corral",
    "grep",
    "ps -axo",
    "crash-handler",
    "crashpad",
    "mcp-server",
    "/extensions/",
    "helper",
    "renderer",
    "gpu-process",
    "utility-network",
    "wakatime",
    "codebook",
    "package-version",
];

fn detect_ide(args: &str) -> Option<&'static str> {
    let lower = args.to_lowercase();
    for (name, markers) in IDE_MARKERS {
        if markers.iter().any(|m| lower.contains(m)) {
            return Some(name);
        }
    }
    None
}

fn is_noise(args: &str) -> bool {
    let lower = args.to_lowercase();
    NOISE.iter().any(|n| lower.contains(n)) || lower.ends_with("node") || lower.contains("/node ")
}

fn base_of(args: &str) -> String {
    let first = args.split_whitespace().next().unwrap_or("");
    first
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

pub fn scan_agents() -> Vec<RunningAgent> {
    let mut by_pid: HashMap<i64, (i64, String)> = HashMap::new();
    let mut rows: Vec<(i64, String)> = Vec::new();
    for (pid, ppid, args) in crate::platform::process_rows() {
        by_pid.insert(pid, (ppid, args.clone()));
        rows.push((pid, args));
    }

    let parent_ide = |pid: i64| -> Option<&'static str> {
        let mut cur = by_pid.get(&pid).map(|(ppid, _)| *ppid);
        for _ in 0..6 {
            let Some(c) = cur else { break };
            if c == 0 {
                break;
            }
            let Some((ppid, args)) = by_pid.get(&c) else {
                break;
            };
            if let Some(hit) = detect_ide(args) {
                return Some(hit);
            }
            cur = Some(*ppid);
        }
        None
    };

    let mut agents = Vec::new();
    for (pid, args) in rows {
        if is_noise(&args) {
            continue;
        }
        let base = base_of(&args).trim_end_matches(".exe").to_string();
        let base_l = base.to_lowercase();
        let args_l = args.to_lowercase();
        let is_opencode = base_l.contains("opencode")
            || (args_l.contains("opencode")
                && !(args_l.contains("zed.app")
                    || args_l.contains("cursor.app")
                    || args_l.contains("code.app")
                    || args_l.contains("windsurf.app")));
        if is_opencode {
            let command: String = args.chars().take(300).collect();
            agents.push(RunningAgent {
                name: "OpenCode".to_string(),
                pid,
                command,
                cwd: None,
                ide: parent_ide(pid).map(|s| s.to_string()),
            });
        }
        if agents.len() >= 100 {
            break;
        }
    }
    agents
}
