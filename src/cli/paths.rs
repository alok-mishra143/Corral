use std::path::PathBuf;

pub fn global_opencode_plugin_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join(".config")
        .join("opencode")
        .join("plugins")
}
