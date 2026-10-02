use crate::cli::paths;
use crate::{error, success};
use std::fs;

const PLUGIN_TEMPLATE: &str = include_str!("../../integrations/opencode/plugin.ts");

pub fn run_setup() -> i32 {
    if !PLUGIN_TEMPLATE.contains("CorralPlugin") {
        error!("Embedded plugin template is missing CorralPlugin.");
        return 1;
    }
    let dest_dir = paths::global_opencode_plugin_dir();
    if fs::create_dir_all(&dest_dir).is_err() {
        error!("Setup failed: could not create plugin directory.");
        return 1;
    }
    let dest = dest_dir.join("corral.ts");
    if fs::write(&dest, PLUGIN_TEMPLATE).is_err() {
        error!("Setup failed: could not write plugin.");
        return 1;
    }
    success!("OpenCode plugin installed → {}", dest.display());
    println!();
    println!("Next steps:");
    println!("  1. corral daemon               # must be running to enforce rules");
    println!("  2. restart OpenCode                # so it loads the plugin");
    println!("  3. corral rules deny --file '**/notes.md'");
    println!("  4. corral doctor               # verify everything");
    0
}
