//! Tauri commands for Pi coding agent CLI management.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::time::Duration;
use tauri::AppHandle;

use super::config::resolve_cli_binary;
use crate::platform::silent_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiCliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModelInfo {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_thinking: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLoginInfo {
    pub command: String,
    pub message: String,
}

#[tauri::command]
pub async fn check_pi_cli_installed(app: AppHandle) -> Result<PiCliStatus, String> {
    let binary = resolve_cli_binary(&app);
    let output = silent_command(&binary).arg("--version").output();
    match output {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(PiCliStatus {
                installed: true,
                version: (!version.is_empty()).then_some(version),
                path: Some(binary.to_string_lossy().to_string()),
            })
        }
        Ok(_output) => Ok(PiCliStatus {
            installed: false,
            version: None,
            path: Some(binary.to_string_lossy().to_string()).filter(|_| binary.exists()),
        }),
        Err(_) => Ok(PiCliStatus {
            installed: false,
            version: None,
            path: None,
        }),
    }
}

#[tauri::command]
pub async fn pi_login(_app: AppHandle) -> Result<PiLoginInfo, String> {
    Ok(PiLoginInfo {
        command: "pi /login".to_string(),
        message: "Run `pi /login` in a terminal for OAuth providers, or set provider API-key \
                  environment variables such as OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or \
                  OPENAI_API_KEY."
            .to_string(),
    })
}

#[tauri::command]
pub async fn list_pi_models(app: AppHandle) -> Result<Vec<PiModelInfo>, String> {
    let binary = resolve_cli_binary(&app);
    let mut child = silent_command(&binary)
        .args(["--mode", "rpc"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pi RPC: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open pi stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to open pi stdout")?;
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"id":"models","type":"get_available_models"})
    )
    .map_err(|e| format!("Failed to request pi models: {e}"))?;
    stdin.flush().ok();

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    if buf.ends_with(b"\n") {
                        buf.pop();
                    }
                    if buf.ends_with(b"\r") {
                        buf.pop();
                    }
                    if let Ok(line) = String::from_utf8(buf.clone()) {
                        if let Ok(value) = serde_json::from_str::<Value>(&line) {
                            if value.get("type").and_then(|v| v.as_str()) == Some("response")
                                && value.get("id").and_then(|v| v.as_str()) == Some("models")
                            {
                                let _ = tx.send(value);
                                break;
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    let response = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out waiting for pi model list".to_string());
    let _ = child.kill();
    let _ = child.wait();

    let response = response?;
    if response.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("pi returned an error while listing models")
            .to_string());
    }

    let models = response
        .get("data")
        .and_then(|d| d.get("models"))
        .and_then(|m| m.as_array())
        .ok_or("pi model response did not include data.models")?;

    Ok(models.iter().filter_map(model_from_value).collect())
}

fn model_from_value(value: &Value) -> Option<PiModelInfo> {
    let id = value
        .get("id")
        .or_else(|| value.get("modelId"))
        .or_else(|| value.get("model"))
        .and_then(|v| v.as_str())?
        .to_string();
    let provider = value
        .get("provider")
        .and_then(|p| {
            p.as_str()
                .map(ToOwned::to_owned)
                .or_else(|| p.get("id").and_then(|v| v.as_str()).map(ToOwned::to_owned))
                .or_else(|| {
                    p.get("name")
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                })
        })
        .or_else(|| {
            value
                .get("providerId")
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "default".to_string());
    let label = value
        .get("label")
        .or_else(|| value.get("name"))
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{provider}/{id}"));
    let context_window = value
        .get("contextWindow")
        .or_else(|| value.get("context_window"))
        .and_then(|v| v.as_u64());
    let supports_thinking = value
        .get("supportsThinking")
        .or_else(|| value.get("supports_thinking"))
        .and_then(|v| v.as_bool());
    Some(PiModelInfo {
        value: format!("pi/{provider}/{id}"),
        id,
        provider,
        label,
        context_window,
        supports_thinking,
    })
}
