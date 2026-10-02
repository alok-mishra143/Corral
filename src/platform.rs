//! Platform-specific process, port and terminal helpers.

use std::io::IsTerminal;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

/// Whether stdin is attached to a terminal.
pub fn is_tty() -> bool {
    std::io::stdin().is_terminal()
}
