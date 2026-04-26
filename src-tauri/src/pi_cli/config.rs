//! Configuration and path management for the Pi coding agent CLI.

use crate::platform::silent_command;
use std::path::PathBuf;

#[cfg(windows)]
pub const CLI_BINARY_NAME: &str = "pi.cmd";
#[cfg(not(windows))]
pub const CLI_BINARY_NAME: &str = "pi";

/// Resolve the Pi binary from PATH. Pi is distributed by npm/Homebrew and is not Jean-managed.
pub fn resolve_cli_binary(_app: &tauri::AppHandle) -> PathBuf {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    match silent_command(which_cmd).arg(CLI_BINARY_NAME).output() {
        Ok(output) if output.status.success() => {
            let path_str = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path_str.is_empty() {
                let path = PathBuf::from(&path_str);
                if path.exists() {
                    return path;
                }
            }
        }
        Ok(output) => {
            log::debug!(
                "resolve_pi_binary: `{which_cmd} {CLI_BINARY_NAME}` failed: {}",
                output.status
            );
        }
        Err(e) => {
            log::debug!(
                "resolve_pi_binary: `{which_cmd} {CLI_BINARY_NAME}` failed to execute: {e}"
            );
        }
    }
    PathBuf::from(CLI_BINARY_NAME)
}
