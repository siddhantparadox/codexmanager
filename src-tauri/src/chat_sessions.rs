use serde::Deserialize;
use serde_json::{Map, Value};
use std::{
  collections::HashMap,
  fs::File,
  io::{BufRead, BufReader},
  path::{Path, PathBuf},
  time::SystemTime,
};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use walkdir::WalkDir;

use crate::models::ChatMessage;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionSummary {
  pub id: String,
  pub first_ts: Option<i64>,
  pub last_ts: Option<i64>,
  pub message_count: u64,
  pub last_model: Option<String>,
  pub last_cwd: Option<String>,
}

pub fn session_messages_latest(
  sessions_dir: &Path,
  session_id: &str,
  limit: usize,
) -> std::io::Result<(Vec<ChatMessage>, usize, Option<usize>)> {
  let path = find_session_path(sessions_dir, session_id)?;
  let messages = load_session_messages(&path)?;
  let total = messages.len();
  let start = total.saturating_sub(limit);
  let slice = messages[start..].to_vec();
  let next_cursor = if start > 0 { Some(start) } else { None };
  Ok((slice, total, next_cursor))
}

pub fn session_messages_page(
  sessions_dir: &Path,
  session_id: &str,
  cursor: usize,
  limit: usize,
) -> std::io::Result<(Vec<ChatMessage>, usize, Option<usize>)> {
  let path = find_session_path(sessions_dir, session_id)?;
  let messages = load_session_messages(&path)?;
  let total = messages.len();
  let clamped_cursor = cursor.min(total);
  if clamped_cursor == 0 {
    return Ok((Vec::new(), total, None));
  }
  let start = clamped_cursor.saturating_sub(limit);
  let slice = messages[start..clamped_cursor].to_vec();
  let next_cursor = if start > 0 { Some(start) } else { None };
  Ok((slice, total, next_cursor))
}

fn find_session_path(sessions_dir: &Path, session_id: &str) -> std::io::Result<PathBuf> {
  let candidate = sessions_dir.join(format!("{}.jsonl", session_id));
  if candidate.exists() {
    return Ok(candidate);
  }
  for entry in WalkDir::new(sessions_dir)
    .into_iter()
    .filter_map(Result::ok)
    .filter(|e| e.file_type().is_file())
  {
    if entry.path().extension().and_then(|s| s.to_str()) != Some("jsonl") {
      continue;
    }
    if entry
      .path()
      .file_stem()
      .and_then(|s| s.to_str())
      .is_some_and(|stem| stem == session_id)
    {
      return Ok(entry.path().to_path_buf());
    }
  }
  Err(std::io::Error::new(
    std::io::ErrorKind::NotFound,
    "Session file not found",
  ))
}

fn load_session_messages(path: &Path) -> std::io::Result<Vec<ChatMessage>> {
  let file = File::open(path)?;
  let reader = BufReader::new(file);
  let mut messages = Vec::new();

  for (idx, line) in reader.lines().enumerate() {
    let line = match line {
      Ok(s) => s,
      Err(_) => continue,
    };
    if line.trim().is_empty() {
      continue;
    }
    let parsed: JsonLine = match serde_json::from_str(&line) {
      Ok(v) => v,
      Err(_) => continue,
    };
    if let Some(message) = extract_message(&parsed, idx) {
      if let Some(last) = messages.last() {
        if is_duplicate_message(last, &message) {
          if should_replace_duplicate(last, &message) {
            messages.pop();
            messages.push(message);
          }
          continue;
        }
      }
      messages.push(message);
    }
  }

  Ok(messages)
}

fn is_duplicate_message(prev: &ChatMessage, next: &ChatMessage) -> bool {
  if prev.role != next.role {
    return false;
  }
  if prev.content != next.content {
    return false;
  }
  match (prev.timestamp, next.timestamp) {
    (Some(a), Some(b)) => (a - b).abs() <= 1,
    (None, None) => true,
    _ => false,
  }
}

fn should_replace_duplicate(prev: &ChatMessage, next: &ChatMessage) -> bool {
  let prev_raw = prev.raw_type.as_deref();
  let next_raw = next.raw_type.as_deref();
  if prev_raw == Some("message") && next_raw != Some("message") {
    return true;
  }
  false
}

fn extract_message(parsed: &JsonLine, idx: usize) -> Option<ChatMessage> {
  let raw_type = raw_type_for(parsed);
  let ts = parsed
    .timestamp
    .as_deref()
    .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
    .map(|dt| dt.unix_timestamp());

  if let Some(role) = parsed.payload.get("role").and_then(|v| v.as_str()) {
    if is_system_role(role) {
      return None;
    }
    let mut content = parse_content(parsed.payload.get("content"));
    let tool_meta = extract_tool_meta_with_role(&parsed.payload, Some(role));
    let mut kind = kind_from_role(role);
    if role.eq_ignore_ascii_case("assistant")
      && payload_has_tool_items(&parsed.payload)
      && !payload_has_text_content(&parsed.payload)
    {
      kind = "tool";
      let raw_hint = raw_type.as_deref().unwrap_or("tool_call");
      let tool_content = extract_payload_text(&parsed.payload, raw_hint, "tool");
      if !tool_content.trim().is_empty() {
        content = tool_content;
      }
    }
    if content.trim().is_empty() {
      return None;
    }
    return Some(ChatMessage {
      id: idx.to_string(),
      role: role.to_string(),
      content,
      timestamp: ts,
      tool_name: tool_meta.name,
      tool_call_id: tool_meta.call_id,
      tool_status: tool_meta.status,
      kind: Some(kind.to_string()),
      subtype: raw_type.clone(),
      raw_type: raw_type.clone(),
    });
  }

  if let Some(message) = parsed.payload.get("message") {
    if let Some(role) = message.get("role").and_then(|v| v.as_str()) {
      if is_system_role(role) {
        return None;
      }
      let mut content = parse_content(message.get("content"));
      let mut tool_meta = extract_tool_meta_with_role(message, Some(role));
      tool_meta.merge(extract_tool_meta_with_role(&parsed.payload, Some(role)));
      let mut kind = kind_from_role(role);
      if role.eq_ignore_ascii_case("assistant")
        && payload_has_tool_items(message)
        && !payload_has_text_content(message)
      {
        kind = "tool";
        let raw_hint = raw_type.as_deref().unwrap_or("tool_call");
        let tool_content = extract_payload_text(message, raw_hint, "tool");
        if !tool_content.trim().is_empty() {
          content = tool_content;
        }
      }
      if content.trim().is_empty() {
        return None;
      }
      return Some(ChatMessage {
        id: idx.to_string(),
        role: role.to_string(),
        content,
        timestamp: ts,
        tool_name: tool_meta.name,
        tool_call_id: tool_meta.call_id,
        tool_status: tool_meta.status,
        kind: Some(kind.to_string()),
        subtype: raw_type.clone(),
        raw_type: raw_type.clone(),
      });
    }
  }

  if let Some(kind) = raw_type.as_deref() {
    if is_system_kind(kind) {
      return None;
    }
    let resolved_kind = kind_from_raw_type(kind);
    let role = role_for_kind(resolved_kind);
    let mut content = extract_payload_text(&parsed.payload, kind, resolved_kind);
    if content.trim().is_empty() && resolved_kind == "meta" {
      content = summarize_meta(kind, &parsed.payload).unwrap_or_default();
    }
    if content.trim().is_empty() && resolved_kind != "meta" {
      return None;
    }
    let tool_meta = extract_tool_meta_with_role(&parsed.payload, Some(role));
    return Some(ChatMessage {
      id: idx.to_string(),
      role: role.to_string(),
      content,
      timestamp: ts,
      tool_name: tool_meta.name,
      tool_call_id: tool_meta.call_id,
      tool_status: tool_meta.status,
      kind: Some(resolved_kind.to_string()),
      subtype: Some(kind.to_string()),
      raw_type: Some(kind.to_string()),
    });
  }

  None
}

#[derive(Default, Clone)]
struct ToolMeta {
  name: Option<String>,
  call_id: Option<String>,
  status: Option<String>,
}

impl ToolMeta {
  fn merge(&mut self, other: ToolMeta) {
    if self.name.is_none() {
      self.name = other.name;
    }
    if self.call_id.is_none() {
      self.call_id = other.call_id;
    }
    if self.status.is_none() {
      self.status = other.status;
    }
  }
}

fn extract_tool_meta_with_role(value: &Value, role: Option<&str>) -> ToolMeta {
  let mut meta = extract_tool_meta(value);
  if meta.name.is_none() && role == Some("tool") {
    if let Some(map) = value.as_object() {
      meta.name = map
        .get("tool_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| map.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()));
    }
  }
  meta
}

fn extract_tool_meta(value: &Value) -> ToolMeta {
  let mut meta = ToolMeta::default();
  match value {
    Value::Object(map) => {
      meta.merge(extract_tool_meta_from_map(map));
      if let Some(content) = map.get("content") {
        meta.merge(extract_tool_meta(content));
      }
      if let Some(message) = map.get("message") {
        meta.merge(extract_tool_meta(message));
      }
      if let Some(tool) = map.get("tool") {
        meta.merge(extract_tool_meta(tool));
      }
      if let Some(tool_calls) = map.get("tool_calls") {
        meta.merge(extract_tool_meta(tool_calls));
      }
      if let Some(tools) = map.get("tools") {
        meta.merge(extract_tool_meta(tools));
      }
    }
    Value::Array(items) => {
      for item in items {
        meta.merge(extract_tool_meta(item));
      }
    }
    _ => {}
  }
  meta
}

fn extract_tool_meta_from_map(map: &Map<String, Value>) -> ToolMeta {
  let type_hint = map.get("type").and_then(|v| v.as_str());
  let type_hint_lower = type_hint.map(|value| value.to_ascii_lowercase());
  let is_toolish = type_hint_lower
    .as_deref()
    .map(|value| value.contains("tool") || is_tool_type(value))
    .unwrap_or(false)
    || map.contains_key("tool_name")
    || map.contains_key("tool_call_id")
    || map.contains_key("tool")
    || map.contains_key("tool_calls");

  let mut meta = ToolMeta::default();
  if !is_toolish {
    return meta;
  }

  meta.name = map
    .get("tool_name")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
    .or_else(|| map.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
    .or_else(|| map.get("tool").and_then(|v| v.as_str()).map(|s| s.to_string()));

  meta.call_id = map
    .get("tool_call_id")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
    .or_else(|| map.get("call_id").and_then(|v| v.as_str()).map(|s| s.to_string()))
    .or_else(|| map.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()));

  meta.status = map
    .get("status")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
    .or_else(|| map.get("state").and_then(|v| v.as_str()).map(|s| s.to_string()))
    .or_else(|| map.get("result").and_then(|v| v.as_str()).map(|s| s.to_string()))
    .or_else(|| map.get("outcome").and_then(|v| v.as_str()).map(|s| s.to_string()));

  meta
}

fn parse_content(value: Option<&Value>) -> String {
  let Some(value) = value else {
    return String::new();
  };
  match value {
    Value::String(text) => text.to_string(),
    Value::Array(items) => {
      let mut parts = Vec::new();
      for item in items {
        match item {
          Value::String(text) => parts.push(text.to_string()),
          Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
              parts.push(text.to_string());
            } else if let Some(content) = map.get("content").and_then(|v| v.as_str()) {
              parts.push(content.to_string());
            } else if let Some(value) = map.get("value").and_then(|v| v.as_str()) {
              parts.push(value.to_string());
            }
          }
          _ => {}
        }
      }
      if parts.is_empty() {
        value.to_string()
      } else {
        parts.join("")
      }
    }
    Value::Object(map) => {
      if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
        text.to_string()
      } else if let Some(content) = map.get("content").and_then(|v| v.as_str()) {
        content.to_string()
      } else if let Some(value) = map.get("value").and_then(|v| v.as_str()) {
        value.to_string()
      } else {
        value.to_string()
      }
    }
    _ => value.to_string(),
  }
}

fn payload_has_tool_items(value: &Value) -> bool {
  match value {
    Value::Object(map) => {
      if let Some(kind) = map.get("type").and_then(|v| v.as_str()) {
        let lower = kind.to_ascii_lowercase();
        if lower.contains("tool") || is_tool_type(&lower) {
          return true;
        }
      }
      if map.contains_key("tool_calls")
        || map.contains_key("tool_call")
        || map.contains_key("tool_name")
        || map.contains_key("tool_call_id")
      {
        return true;
      }
      if let Some(content) = map.get("content") {
        if payload_has_tool_items(content) {
          return true;
        }
      }
      if let Some(message) = map.get("message") {
        if payload_has_tool_items(message) {
          return true;
        }
      }
      if let Some(tool) = map.get("tool") {
        if payload_has_tool_items(tool) {
          return true;
        }
      }
      false
    }
    Value::Array(items) => items.iter().any(payload_has_tool_items),
    _ => false,
  }
}

fn payload_has_text_content(value: &Value) -> bool {
  match value {
    Value::String(text) => !text.trim().is_empty(),
    Value::Array(items) => items.iter().any(payload_has_text_content),
    Value::Object(map) => {
      if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
        if !text.trim().is_empty() {
          return true;
        }
      }
      if let Some(content) = map.get("content") {
        if let Some(text) = content.as_str() {
          if !text.trim().is_empty() {
            return true;
          }
        }
        if payload_has_text_content(content) {
          return true;
        }
      }
      if let Some(value) = map.get("value").and_then(|v| v.as_str()) {
        if !value.trim().is_empty() {
          return true;
        }
      }
      false
    }
    _ => false,
  }
}

#[derive(Debug, Clone, Default)]
pub struct IndexStats {
  pub files_seen: usize,
  pub files_parsed: usize,
  pub parse_errors: usize,
}

#[derive(Debug, Clone)]
struct CacheEntry {
  size: u64,
  mtime: SystemTime,
  summary: SessionSummary,
}

#[derive(Debug, Default)]
pub struct SessionIndexCache {
  entries: HashMap<PathBuf, CacheEntry>,
}

#[derive(Debug, Deserialize)]
struct JsonLine {
  timestamp: Option<String>,
  #[serde(rename = "type")]
  kind: String,
  payload: Value,
}

pub fn index_sessions(
  sessions_dir: &Path,
  mut cache: Option<&mut SessionIndexCache>,
) -> std::io::Result<(Vec<SessionSummary>, IndexStats)> {
  let mut stats = IndexStats::default();
  let mut sessions = Vec::new();
  let mut next_entries: HashMap<PathBuf, CacheEntry> = HashMap::new();

  if !sessions_dir.is_dir() {
    return Ok((sessions, stats));
  }

  for entry in WalkDir::new(sessions_dir)
    .into_iter()
    .filter_map(Result::ok)
    .filter(|e| e.file_type().is_file())
  {
    if entry.path().extension().and_then(|s| s.to_str()) != Some("jsonl") {
      continue;
    }
    stats.files_seen += 1;
    let path = entry.path().to_path_buf();
    let meta = entry.metadata()?;
    let size = meta.len();
    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

    if let Some(cache_ref) = cache.as_deref_mut() {
      if let Some(existing) = cache_ref.entries.get(&path) {
        if existing.size == size && existing.mtime == mtime {
          sessions.push(existing.summary.clone());
          next_entries.insert(path.clone(), existing.clone());
          continue;
        }
      }
    }

    let (summary, parse_errors) = parse_session_file(&path)?;
    stats.files_parsed += 1;
    stats.parse_errors += parse_errors;
    sessions.push(summary.clone());
    if let Some(_) = cache.as_deref_mut() {
      next_entries.insert(
        path.clone(),
        CacheEntry {
          size,
          mtime,
          summary,
        },
      );
    }
  }

  if let Some(cache_ref) = cache.as_deref_mut() {
    cache_ref.entries = next_entries;
  }

  Ok((sessions, stats))
}

fn parse_session_file(path: &Path) -> std::io::Result<(SessionSummary, usize)> {
  let id = path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("session")
    .to_string();
  let file = File::open(path)?;
  let reader = BufReader::new(file);
  let mut summary = SessionSummary {
    id,
    ..Default::default()
  };
  let mut parse_errors = 0usize;

  for line in reader.lines() {
    let line = match line {
      Ok(s) => s,
      Err(_) => continue,
    };
    if line.trim().is_empty() {
      continue;
    }
    let parsed: JsonLine = match serde_json::from_str(&line) {
      Ok(v) => v,
      Err(_) => {
        parse_errors += 1;
        continue;
      }
    };

    if let Some(ts) = parsed.timestamp.as_deref() {
      if let Ok(dt) = OffsetDateTime::parse(ts, &Rfc3339) {
        let epoch = dt.unix_timestamp();
        summary.first_ts = Some(match summary.first_ts {
          Some(current) => current.min(epoch),
          None => epoch,
        });
        summary.last_ts = Some(match summary.last_ts {
          Some(current) => current.max(epoch),
          None => epoch,
        });
      }
    }

    if parsed.kind == "turn_context" {
      summary.last_model = parsed
        .payload
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      summary.last_cwd = parsed
        .payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      continue;
    }

    if parsed.kind == "session_meta" {
      let cwd = parsed
        .payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      if summary
        .last_cwd
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
      {
        if let Some(value) = cwd.filter(|value| !value.trim().is_empty()) {
          summary.last_cwd = Some(value);
        }
      }
      continue;
    }

    if is_message_event(parsed.kind.as_str(), &parsed.payload) {
      summary.message_count += 1;
    }
  }

  Ok((summary, parse_errors))
}

fn is_message_event(kind: &str, payload: &Value) -> bool {
  if kind != "event_msg" && kind != "message" {
    return false;
  }
  if payload
    .get("type")
    .and_then(|v| v.as_str())
    .is_some_and(|t| t == "token_count")
  {
    return false;
  }
  if payload.get("role").is_some() {
    if payload
      .get("role")
      .and_then(|v| v.as_str())
      .is_some_and(is_system_role)
    {
      return false;
    }
    return true;
  }
  if payload
    .get("message")
    .and_then(|v| v.get("role"))
    .is_some()
  {
    if payload
      .get("message")
      .and_then(|v| v.get("role"))
      .and_then(|v| v.as_str())
      .is_some_and(is_system_role)
    {
      return false;
    }
    return true;
  }
  if let Some(kind) = payload.get("type").and_then(|v| v.as_str()) {
    if is_system_kind(kind) {
      return false;
    }
    return matches!(kind, "assistant_message" | "user_message" | "message");
  }
  false
}

fn is_system_role(role: &str) -> bool {
  role.eq_ignore_ascii_case("system")
}

fn is_system_kind(kind: &str) -> bool {
  let lower = kind.to_ascii_lowercase();
  lower == "system_message" || lower.starts_with("system_")
}

fn raw_type_for(parsed: &JsonLine) -> Option<String> {
  if let Some(kind) = parsed.payload.get("type").and_then(|v| v.as_str()) {
    return Some(kind.to_string());
  }
  if parsed.kind != "event_msg" {
    return Some(parsed.kind.clone());
  }
  None
}

fn kind_from_role(role: &str) -> &'static str {
  let lower = role.to_ascii_lowercase();
  if lower == "user" {
    "user"
  } else if lower == "assistant" {
    "assistant"
  } else if lower == "developer" {
    "developer"
  } else if lower == "tool" {
    "tool"
  } else {
    "meta"
  }
}

fn kind_from_raw_type(raw_type: &str) -> &'static str {
  let lower = raw_type.to_ascii_lowercase();
  if is_tool_type(&lower) {
    "tool"
  } else if is_reasoning_type(&lower) {
    "reasoning"
  } else if is_assistant_output_type(&lower) {
    "assistant"
  } else if is_user_input_type(&lower) {
    "user"
  } else if is_meta_type(&lower) {
    "meta"
  } else {
    "meta"
  }
}

fn role_for_kind(kind: &str) -> &'static str {
  match kind {
    "user" => "user",
    "assistant" => "assistant",
    "developer" => "developer",
    "tool" => "tool",
    "reasoning" => "reasoning",
    _ => "meta",
  }
}

fn is_tool_type(kind: &str) -> bool {
  matches!(
    kind,
    "function_call"
      | "function_call_output"
      | "custom_tool_call"
      | "custom_tool_call_output"
      | "tool_call"
      | "tool_call_output"
      | "tool_result"
      | "tool_result_output"
      | "web_search_call"
      | "web_search_call_output"
      | "search"
      | "open_page"
      | "find_in_page"
  )
}

fn is_reasoning_type(kind: &str) -> bool {
  matches!(
    kind,
    "reasoning" | "agent_reasoning" | "summary_text" | "plan"
  )
}

fn is_assistant_output_type(kind: &str) -> bool {
  matches!(
    kind,
    "assistant_message" | "agent_message" | "output_text" | "message"
  )
}

fn is_user_input_type(kind: &str) -> bool {
  matches!(kind, "user_message" | "input_text")
}

fn is_meta_type(kind: &str) -> bool {
  matches!(
    kind,
    "session_meta"
      | "turn_context"
      | "token_count"
      | "compaction"
      | "context_compacted"
      | "compacted"
      | "turn_aborted"
      | "item_completed"
      | "ghost_snapshot"
      | "workspace-write"
      | "read-only"
      | "input_image"
      | "response_item"
  )
}

fn extract_payload_text(payload: &Value, raw_type: &str, kind: &str) -> String {
  if let Some(content) = payload.get("content") {
    let text = parse_content(Some(content));
    if !text.trim().is_empty() {
      return text;
    }
  }
  if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
    if !text.trim().is_empty() {
      return text.to_string();
    }
  }
  if let Some(message) = payload.get("message") {
    if let Some(text) = message.as_str() {
      if !text.trim().is_empty() {
        return text.to_string();
      }
    }
    if let Some(content) = message.get("content") {
      let text = parse_content(Some(content));
      if !text.trim().is_empty() {
        return text;
      }
    }
    if let Some(text) = message.get("text").and_then(|v| v.as_str()) {
      if !text.trim().is_empty() {
        return text.to_string();
      }
    }
  }
  if let Some(output) = payload.get("output") {
    if let Some(text) = output.as_str() {
      if !text.trim().is_empty() {
        return text.to_string();
      }
    } else if !output.is_null() {
      return output.to_string();
    }
  }
  if let Some(arguments) = payload.get("arguments") {
    if let Some(text) = arguments.as_str() {
      if !text.trim().is_empty() {
        return text.to_string();
      }
    } else if !arguments.is_null() {
      return arguments.to_string();
    }
  }
  if let Some(summary) = payload.get("summary").and_then(|v| v.as_array()) {
    let mut parts = Vec::new();
    for item in summary {
      if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
        parts.push(text.to_string());
      } else if let Some(text) = item.get("summary_text").and_then(|v| v.as_str()) {
        parts.push(text.to_string());
      } else if let Some(text) = item.get("content").and_then(|v| v.as_str()) {
        parts.push(text.to_string());
      }
    }
    if !parts.is_empty() {
      return parts.join("\n");
    }
  }
  if kind == "meta" {
    return summarize_meta(raw_type, payload).unwrap_or_default();
  }
  String::new()
}

fn summarize_meta(raw_type: &str, payload: &Value) -> Option<String> {
  let lower = raw_type.to_ascii_lowercase();
  if lower == "session_meta" {
    let cwd = payload.get("cwd").and_then(|v| v.as_str());
    let id = payload.get("id").and_then(|v| v.as_str());
    let source = payload.get("source").and_then(|v| v.as_str());
    let cli = payload.get("cli_version").and_then(|v| v.as_str());
    let mut parts = Vec::new();
    if let Some(value) = cwd { parts.push(format!("cwd: {}", value)); }
    if let Some(value) = id { parts.push(format!("id: {}", value)); }
    if let Some(value) = source { parts.push(format!("source: {}", value)); }
    if let Some(value) = cli { parts.push(format!("cli: {}", value)); }
    return Some(parts.join(" | "));
  }
  if lower == "turn_context" {
    let model = payload.get("model").and_then(|v| v.as_str());
    let cwd = payload.get("cwd").and_then(|v| v.as_str());
    let mut parts = Vec::new();
    if let Some(value) = model { parts.push(format!("model: {}", value)); }
    if let Some(value) = cwd { parts.push(format!("cwd: {}", value)); }
    return Some(parts.join(" | "));
  }
  if lower == "token_count" {
    let totals = payload
      .get("info")
      .and_then(|v| v.get("total_token_usage"));
    let total_tokens = totals.and_then(|v| v.get("total_tokens")).and_then(|v| v.as_u64());
    let input_tokens = totals.and_then(|v| v.get("input_tokens")).and_then(|v| v.as_u64());
    let output_tokens = totals.and_then(|v| v.get("output_tokens")).and_then(|v| v.as_u64());
    let cached_tokens = totals
      .and_then(|v| v.get("cached_input_tokens"))
      .and_then(|v| v.as_u64());
    let mut parts = Vec::new();
    if let Some(value) = total_tokens { parts.push(format!("total: {}", value)); }
    if let Some(value) = input_tokens { parts.push(format!("input: {}", value)); }
    if let Some(value) = cached_tokens { parts.push(format!("cached: {}", value)); }
    if let Some(value) = output_tokens { parts.push(format!("output: {}", value)); }
    if !parts.is_empty() {
      return Some(parts.join(" | "));
    }
  }
  if matches!(lower.as_str(), "workspace-write" | "read-only") {
    return Some(format!("sandbox: {}", raw_type));
  }
  None
}
