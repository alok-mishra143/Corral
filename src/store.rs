use crate::events::{parse_event, AgentEvent};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_SEEN_IDS: usize = 5000;
const ID_TAIL_BYTES: u64 = 64 * 1024;
const FIRST_WINDOW_BYTES: u64 = 64 * 1024;

pub fn default_store_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home).join(".corral").join("events.jsonl")
}

struct Inner {
    seen: HashSet<String>,
    order: VecDeque<String>,
    loaded: bool,
}

pub struct EventStore {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl EventStore {
    pub fn new(path: Option<PathBuf>) -> Self {
        EventStore {
            path: path.unwrap_or_else(default_store_path),
            inner: Mutex::new(Inner {
                seen: HashSet::new(),
                order: VecDeque::new(),
                loaded: false,
            }),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn remember(inner: &mut Inner, id: &str) {
        if inner.seen.contains(id) {
            return;
        }
        inner.seen.insert(id.to_string());
        inner.order.push_back(id.to_string());
        while inner.order.len() > MAX_SEEN_IDS {
            if let Some(oldest) = inner.order.pop_front() {
                inner.seen.remove(&oldest);
            }
        }
    }

    fn ensure_loaded(&self, inner: &mut Inner) {
        if inner.loaded {
            return;
        }
        inner.loaded = true;
        let Ok((text, truncated)) = read_tail_text(&self.path, ID_TAIL_BYTES) else {
            return;
        };
        let lines: Vec<&str> = text.split('\n').collect();
        let start = if truncated { 1 } else { 0 };
        for line in lines.iter().skip(start) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(obj) = serde_json::from_str::<Value>(line) {
                if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                    Self::remember(inner, id);
                }
            }
        }
    }

    pub fn append(&self, input: &Value) -> Option<AgentEvent> {
        let event = parse_event(input)?;
        let mut inner = self.inner.lock().unwrap();
        self.ensure_loaded(&mut inner);
        if inner.seen.contains(&event.id) {
            return Some(event);
        }
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok()?;
        let mut line = serde_json::to_string(&event).ok()?;
        line.push('\n');
        file.write_all(line.as_bytes()).ok()?;
        Self::remember(&mut inner, &event.id);
        Some(event)
    }

    pub fn read_tail(
        &self,
        limit: usize,
        filter: Option<&dyn Fn(&AgentEvent) -> bool>,
    ) -> Vec<AgentEvent> {
        let mut out: Vec<AgentEvent> = Vec::new();
        let mut window = FIRST_WINDOW_BYTES;
        loop {
            let Ok((text, truncated)) = read_tail_text(&self.path, window) else {
                return Vec::new();
            };
            out.clear();
            let lines: Vec<&str> = text.split('\n').collect();
            let start = if truncated { 1 } else { 0 };
            for idx in (start..lines.len()).rev() {
                if out.len() >= limit {
                    break;
                }
                let line = lines[idx].trim();
                if line.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    if let Some(ev) = parse_event(&v) {
                        if filter.is_none_or(|f| f(&ev)) {
                            out.push(ev);
                        }
                    }
                }
            }
            if out.len() >= limit || !truncated {
                break;
            }
            window = window.saturating_mul(4);
        }
        out.reverse();
        out
    }
}

fn read_tail_text(path: &Path, max_bytes: u64) -> io::Result<(String, bool)> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(max_bytes);
    let length = size - start;
    if length == 0 {
        return Ok((String::new(), false));
    }
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; length as usize];
    let mut filled = 0usize;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    Ok((String::from_utf8_lossy(&buf).into_owned(), start > 0))
}
