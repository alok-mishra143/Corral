use crate::cli::{paths, process};
use crate::platform;
use crate::{error, info, success, warn};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn remove_path(p: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(p) else {
        return false;
    };
    if meta.is_dir() {
        fs::remove_dir_all(p).is_ok()
    } else {
        fs::remove_file(p).is_ok()
    }
}

fn is_yes(answer: &str) -> bool {
    let a = answer.trim().to_lowercase();
    a == "yes" || a == "y"
}

fn is_tty() -> bool {
    platform::is_tty()
}

fn read_line() -> String {
    let mut s = String::new();
    let _ = io::stdin().read_line(&mut s);
    s
}

fn ask_choices(keep_data: bool) -> Option<bool> {
    println!("Uninstalling removes the daemon, the OpenCode plugin and the corral command.");
    print!("Are you sure you want to uninstall corral? (yes/no) ");
    let _ = io::stdout().flush();
    if !is_yes(&read_line()) {
        return None;
    }
    if keep_data {
        return Some(false);
    }
    print!("Do you want to remove your saved settings and rules too? (yes/no) ");
    let _ = io::stdout().flush();
    Some(is_yes(&read_line()))
}

fn repo_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..5 {
        let manifest = dir.join("Cargo.toml");
        if let Ok(text) = fs::read_to_string(&manifest) {
            if text.contains("name = \"corral\"") {
                return Some(dir);
            }
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

pub fn run_uninstall(argv: &[String]) -> i32 {
    let yes = process::contains(argv, "--yes") || process::contains(argv, "-y");
    let keep_data = process::contains(argv, "--keep-data");
    let port = process::parse_port(argv);

    let mut remove_data = !keep_data;
    if !yes {
        if !is_tty() {
            error!("Refusing to uninstall non-interactively. Re-run with --yes to confirm.");
            return 1;
        }
        match ask_choices(keep_data) {
            None => {
                info!("Aborted — nothing was changed.");
                return 0;
            }
            Some(rd) => remove_data = rd,
        }
    }

    let mut ok = true;
    let home = std::env::var("HOME").unwrap_or_default();
    let home = Path::new(&home);

    let stop = process::stop_daemon(port);
    match stop.status {
        process::StopStatus::Absent => info!("No daemon listening on :{}.", port),
        process::StopStatus::Failed | process::StopStatus::SelfPid => {
            warn!(
                "Could not stop the daemon on :{} (pid {}) — stop it manually.",
                port, stop.pid
            );
            ok = false;
        }
        _ => success!("Daemon on :{} stopped (pid {}).", port, stop.pid),
    }

    let plugin = paths::global_opencode_plugin_dir().join("corral.ts");
    if remove_path(&plugin) {
        success!("Removed plugin {}", plugin.display());
    } else {
        info!("Plugin was not installed.");
    }

    let bin_dir = home.join(".local").join("bin");
    let p = bin_dir.join("corral");
    if remove_path(&p) {
        success!("Removed command {}", p.display());
    }

    let data_dir = home.join(".corral");
    if !remove_data {
        info!(
            "Kept your settings and rules in {} — a future install will reuse them.",
            data_dir.display()
        );
    } else if remove_path(&data_dir) {
        success!("Removed ~/.corral (rules, settings, events)");
    }

    println!();
    if ok {
        success!("corral uninstalled.");
    } else {
        warn!("corral partially uninstalled — see warnings above.");
    }
    if let Some(repo) = repo_root() {
        println!("The repo checkout itself was kept: {}", repo.display());
        println!("Remove it with: rm -rf \"{}\"", repo.display());
    }
    println!("Restart OpenCode to unload the plugin if it is still running.");
    if ok {
        0
    } else {
        1
    }
}
