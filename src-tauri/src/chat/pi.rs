//! Pi coding agent execution engine.
//!
//! Uses `pi --mode rpc`, a JSONL RPC protocol over stdio. Events are translated
//! into Jean's existing chat event names so the frontend can render Pi like the
//! other backends.

use super::claude::CancelledEvent;
use super::types::{ContentBlock, EffortLevel, ThinkingLevel, ToolCall, UsageData};
use crate::http_server::EmitExt;
use crate::platform::silent_command;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct PiResponse {
    pub content: String,
    pub session_id: String,
    pub tool_calls: Vec<ToolCall>,
    pub content_blocks: Vec<ContentBlock>,
    pub cancelled: bool,
    pub error_emitted: bool,
    pub usage: Option<UsageData>,
}

pub fn execute_one_shot_pi(
    app: &tauri::AppHandle,
    prompt: &str,
    model: &str,
    working_dir: Option<&Path>,
    reasoning_effort: Option<&str>,
) -> Result<String, String> {
    let binary = crate::pi_cli::resolve_cli_binary(app);
    let mut cmd = silent_command(&binary);
    cmd.arg("--mode")
        .arg("rpc")
        .current_dir(working_dir.unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start pi RPC: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    log::debug!("[pi stderr] {line}");
                }
            }
        });
    }

    {
        let mut stdin = child.stdin.take().ok_or("Failed to open pi stdin")?;
        if let Some((provider, model_id)) = parse_pi_model(Some(model)) {
            writeln!(
                stdin,
                "{}",
                serde_json::json!({
                    "id": "set-model",
                    "type": "set_model",
                    "provider": provider,
                    "modelId": model_id,
                })
            )
            .map_err(|e| format!("Failed to set pi model: {e}"))?;
        }
        if let Some(level) = pi_reasoning_level(reasoning_effort) {
            writeln!(
                stdin,
                "{}",
                serde_json::json!({
                    "id": "set-thinking",
                    "type": "set_thinking_level",
                    "level": level,
                })
            )
            .map_err(|e| format!("Failed to set pi thinking level: {e}"))?;
        }
        writeln!(
            stdin,
            "{}",
            serde_json::json!({"id":"prompt","type":"prompt","message":prompt})
        )
        .map_err(|e| format!("Failed to send pi prompt: {e}"))?;
        stdin.flush().ok();
    }

    let stdout = child.stdout.take().ok_or("Failed to open pi stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let mut full_content = String::new();
    let mut prompt_accepted = false;

    loop {
        buf.clear();
        let n = reader
            .read_until(b'\n', &mut buf)
            .map_err(|e| format!("Failed reading pi output: {e}"))?;
        if n == 0 {
            break;
        }
        if buf.ends_with(b"\n") {
            buf.pop();
        }
        if buf.ends_with(b"\r") {
            buf.pop();
        }
        if buf.is_empty() {
            continue;
        }

        let line = match String::from_utf8(buf.clone()) {
            Ok(line) => line,
            Err(e) => {
                log::warn!("Invalid UTF-8 from pi RPC: {e}");
                continue;
            }
        };
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(e) => {
                log::warn!("Invalid JSON from pi RPC: {e}: {line}");
                continue;
            }
        };

        match value.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response" => {
                if value.get("id").and_then(|v| v.as_str()) == Some("prompt") {
                    prompt_accepted = value.get("success").and_then(|v| v.as_bool()) == Some(true);
                    if !prompt_accepted {
                        let err = value
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("pi rejected prompt");
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(err.to_string());
                    }
                }
            }
            "message_update" => {
                let ev = value.get("assistantMessageEvent").unwrap_or(&Value::Null);
                match ev.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "text_delta" => {
                        if let Some(delta) = ev.get("delta").and_then(|v| v.as_str()) {
                            full_content.push_str(delta);
                        }
                    }
                    "error" => {
                        let reason = ev
                            .get("reason")
                            .and_then(|v| v.as_str())
                            .unwrap_or("pi one-shot failed");
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(reason.to_string());
                    }
                    _ => {}
                }
            }
            "agent_end" => break,
            _ => {}
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    if !prompt_accepted {
        return Err("pi did not accept naming prompt".to_string());
    }

    Ok(full_content)
}

#[derive(serde::Serialize, Clone)]
struct ChunkEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct ToolUseEvent {
    session_id: String,
    worktree_id: String,
    id: String,
    name: String,
    input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct ToolResultEvent {
    session_id: String,
    worktree_id: String,
    tool_use_id: String,
    output: String,
}

#[derive(serde::Serialize, Clone)]
struct ThinkingEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct DoneEvent {
    session_id: String,
    worktree_id: String,
    waiting_for_plan: bool,
}

#[derive(serde::Serialize, Clone)]
struct ErrorEvent {
    session_id: String,
    worktree_id: String,
    error: String,
}

#[allow(clippy::too_many_arguments)]
pub fn execute_pi_rpc(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    output_file: &Path,
    working_dir: &Path,
    existing_pi_session_id: Option<&str>,
    model: Option<&str>,
    execution_mode: Option<&str>,
    thinking_level: Option<&ThinkingLevel>,
    effort_level: Option<&EffortLevel>,
    prompt: &str,
    system_prompt: Option<&str>,
) -> Result<(u32, PiResponse), String> {
    let binary = crate::pi_cli::resolve_cli_binary(app);
    let mut cmd = silent_command(&binary);
    cmd.arg("--mode").arg("rpc").current_dir(working_dir);

    if let Some(pi_sid) = existing_pi_session_id.filter(|s| !s.trim().is_empty()) {
        cmd.arg("--session").arg(pi_sid);
    }
    if let Some(prompt) = system_prompt.filter(|s| !s.trim().is_empty()) {
        cmd.arg("--append-system-prompt").arg(prompt);
    }
    match execution_mode.unwrap_or("plan") {
        "plan" => {
            cmd.arg("--tools").arg("read,grep,find,ls");
        }
        "build" => {
            cmd.arg("--tools").arg("read,grep,find,ls,edit,write");
        }
        "yolo" => {}
        _ => {}
    }

    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pi RPC: {e}"))?;
    let pid = child.id();

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    log::debug!("[pi stderr] {line}");
                }
            }
        });
    }

    let stdin = child.stdin.take().ok_or("Failed to open pi stdin")?;
    let stdin = Arc::new(Mutex::new(stdin));
    if !super::registry::register_pi_stdin(session_id.to_string(), stdin.clone()) {
        let _ = child.kill();
        return Err("Request cancelled".to_string());
    }

    {
        let mut writer = stdin.lock().map_err(|_| "Pi stdin mutex poisoned")?;
        if let Some((provider, model_id)) = parse_pi_model(model) {
            writeln!(
                writer,
                "{}",
                serde_json::json!({
                    "id": "set-model",
                    "type": "set_model",
                    "provider": provider,
                    "modelId": model_id,
                })
            )
            .map_err(|e| format!("Failed to set pi model: {e}"))?;
        }
        if let Some(level) = pi_thinking_level(thinking_level, effort_level) {
            writeln!(
                writer,
                "{}",
                serde_json::json!({
                    "id": "set-thinking",
                    "type": "set_thinking_level",
                    "level": level,
                })
            )
            .map_err(|e| format!("Failed to set pi thinking level: {e}"))?;
        }
        writeln!(
            writer,
            "{}",
            serde_json::json!({"id":"state-before","type":"get_state"})
        )
        .map_err(|e| format!("Failed to request pi state: {e}"))?;
        writeln!(
            writer,
            "{}",
            serde_json::json!({"id":"prompt","type":"prompt","message":prompt})
        )
        .map_err(|e| format!("Failed to send pi prompt: {e}"))?;
        writer.flush().ok();
    }

    let stdout = child.stdout.take().ok_or("Failed to open pi stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let mut full_content = String::new();
    let mut current_text_block = String::new();
    let mut current_thinking_block = String::new();
    let mut content_blocks = Vec::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut pi_session_id = existing_pi_session_id.unwrap_or_default().to_string();
    let mut cancelled = false;
    let mut error_emitted = false;
    let mut prompt_accepted = false;

    let mut output_writer = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(output_file)
        .ok();

    super::increment_tailer_count();
    loop {
        buf.clear();
        let n = reader
            .read_until(b'\n', &mut buf)
            .map_err(|e| format!("Failed reading pi output: {e}"))?;
        if n == 0 {
            break;
        }
        if buf.ends_with(b"\n") {
            buf.pop();
        }
        if buf.ends_with(b"\r") {
            buf.pop();
        }
        if buf.is_empty() {
            continue;
        }
        let line = match String::from_utf8(buf.clone()) {
            Ok(line) => line,
            Err(e) => {
                log::warn!("Invalid UTF-8 from pi RPC: {e}");
                continue;
            }
        };
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(e) => {
                log::warn!("Invalid JSON from pi RPC: {e}: {line}");
                continue;
            }
        };
        if let Some(ref mut writer) = output_writer {
            let _ = writeln!(writer, "{line}");
        }

        let event_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match event_type {
            "response" => {
                if value.get("id").and_then(|v| v.as_str()) == Some("prompt") {
                    prompt_accepted = value.get("success").and_then(|v| v.as_bool()) == Some(true);
                    if !prompt_accepted {
                        let err = value
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("pi rejected prompt")
                            .to_string();
                        emit_error(app, session_id, worktree_id, &err);
                        error_emitted = true;
                        break;
                    }
                }
                if let Some(data) = value.get("data") {
                    if let Some(sid) = data.get("sessionId").and_then(|v| v.as_str()) {
                        pi_session_id = sid.to_string();
                    }
                }
                if value.get("success").and_then(|v| v.as_bool()) == Some(false)
                    && value.get("id").and_then(|v| v.as_str()) != Some("set-thinking")
                {
                    log::warn!("pi RPC command failed: {value}");
                }
            }
            "message_update" => {
                let ev = value.get("assistantMessageEvent").unwrap_or(&Value::Null);
                match ev.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "text_delta" => {
                        if let Some(delta) = ev.get("delta").and_then(|v| v.as_str()) {
                            full_content.push_str(delta);
                            current_text_block.push_str(delta);
                            let _ = app.emit_all(
                                "chat:chunk",
                                &ChunkEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    content: delta.to_string(),
                                },
                            );
                        }
                    }
                    "text_end" => flush_text_block(&mut content_blocks, &mut current_text_block),
                    "thinking_delta" => {
                        if let Some(delta) = ev.get("delta").and_then(|v| v.as_str()) {
                            current_thinking_block.push_str(delta);
                            let _ = app.emit_all(
                                "chat:thinking",
                                &ThinkingEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    content: delta.to_string(),
                                },
                            );
                        }
                    }
                    "thinking_end" => {
                        flush_thinking_block(&mut content_blocks, &mut current_thinking_block)
                    }
                    "toolcall_end" => {
                        if let Some(tool) = ev.get("toolCall") {
                            upsert_tool_call(
                                app,
                                session_id,
                                worktree_id,
                                &mut tool_calls,
                                &mut content_blocks,
                                tool,
                            );
                        }
                    }
                    "error" => {
                        let reason = ev.get("reason").and_then(|v| v.as_str()).unwrap_or("error");
                        if reason == "aborted" {
                            cancelled = true;
                        } else {
                            emit_error(app, session_id, worktree_id, reason);
                            error_emitted = true;
                        }
                    }
                    _ => {}
                }
            }
            "tool_execution_start" => {
                upsert_tool_call(
                    app,
                    session_id,
                    worktree_id,
                    &mut tool_calls,
                    &mut content_blocks,
                    &value,
                );
            }
            "tool_execution_end" => {
                let id = value
                    .get("toolCallId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let output = stringify_tool_result(value.get("result").unwrap_or(&Value::Null));
                if let Some(tc) = tool_calls.iter_mut().find(|tc| tc.id == id) {
                    tc.output = Some(output.clone());
                }
                let _ = app.emit_all(
                    "chat:tool-result",
                    &ToolResultEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        tool_use_id: id.to_string(),
                        output,
                    },
                );
            }
            "agent_end" => break,
            _ => {}
        }
    }
    super::decrement_tailer_count();
    super::registry::unregister_pi_stdin(session_id);

    flush_text_block(&mut content_blocks, &mut current_text_block);
    flush_thinking_block(&mut content_blocks, &mut current_thinking_block);

    let _ = child.kill();
    let _ = child.wait();

    if cancelled && !error_emitted {
        let emitted_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let _ = app.emit_all(
            "chat:cancelled",
            &CancelledEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                undo_send: false,
                emitted_at_ms,
            },
        );
    } else if !error_emitted && prompt_accepted {
        let _ = app.emit_all(
            "chat:done",
            &DoneEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                waiting_for_plan: false,
            },
        );
    }

    Ok((
        pid,
        PiResponse {
            content: full_content,
            session_id: pi_session_id,
            tool_calls,
            content_blocks,
            cancelled,
            error_emitted,
            usage: None,
        },
    ))
}

fn parse_pi_model(model: Option<&str>) -> Option<(String, String)> {
    let model = model?;
    let rest = model.strip_prefix("pi/")?;
    let (provider, model_id) = rest.split_once('/')?;
    if provider.is_empty() || model_id.is_empty() {
        None
    } else {
        Some((provider.to_string(), model_id.to_string()))
    }
}

fn pi_thinking_level(
    thinking_level: Option<&ThinkingLevel>,
    effort_level: Option<&EffortLevel>,
) -> Option<&'static str> {
    if let Some(effort) = effort_level {
        return match effort {
            EffortLevel::Off => Some("off"),
            EffortLevel::Low => Some("low"),
            EffortLevel::Medium => Some("medium"),
            EffortLevel::High => Some("high"),
            EffortLevel::Xhigh | EffortLevel::Max => Some("xhigh"),
        };
    }
    thinking_level.map(|level| match level {
        ThinkingLevel::Off => "off",
        ThinkingLevel::Think => "low",
        ThinkingLevel::Megathink => "high",
        ThinkingLevel::Ultrathink => "xhigh",
    })
}

fn pi_reasoning_level(reasoning_effort: Option<&str>) -> Option<&'static str> {
    match reasoning_effort? {
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" | "max" => Some("xhigh"),
        "off" => Some("off"),
        _ => None,
    }
}

fn flush_text_block(blocks: &mut Vec<ContentBlock>, current: &mut String) {
    if !current.is_empty() {
        blocks.push(ContentBlock::Text {
            text: std::mem::take(current),
        });
    }
}

fn flush_thinking_block(blocks: &mut Vec<ContentBlock>, current: &mut String) {
    if !current.is_empty() {
        blocks.push(ContentBlock::Thinking {
            thinking: std::mem::take(current),
        });
    }
}

fn upsert_tool_call(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    value: &Value,
) {
    let id = value
        .get("toolCallId")
        .or_else(|| value.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let name = value
        .get("toolName")
        .or_else(|| value.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let input = value
        .get("args")
        .or_else(|| value.get("input"))
        .cloned()
        .unwrap_or(Value::Null);

    if !tool_calls.iter().any(|tc| tc.id == id) {
        tool_calls.push(ToolCall {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
            output: None,
            parent_tool_use_id: None,
        });
        content_blocks.push(ContentBlock::ToolUse {
            tool_call_id: id.clone(),
        });
        let _ = app.emit_all(
            "chat:tool-use",
            &ToolUseEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                id,
                name,
                input,
                parent_tool_use_id: None,
            },
        );
    }
}

fn stringify_tool_result(value: &Value) -> String {
    if let Some(content) = value.get("content").and_then(|v| v.as_array()) {
        let text = content
            .iter()
            .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return text;
        }
    }
    if let Some(text) = value.get("text").and_then(|v| v.as_str()) {
        return text.to_string();
    }
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn emit_error(app: &tauri::AppHandle, session_id: &str, worktree_id: &str, error: &str) {
    let _ = app.emit_all(
        "chat:error",
        &ErrorEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            error: error.to_string(),
        },
    );
}
