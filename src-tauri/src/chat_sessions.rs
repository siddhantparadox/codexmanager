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
  if cursor == 0 {
    return Ok((Vec::new(), total, None));
  }
  let start = cursor.saturating_sub(limit);
  let slice = messages[start..cursor.min(total)].to_vec();
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
      messages.push(message);
    }
  }

  Ok(messages)
}

fn extract_message(parsed: &JsonLine, idx: usize) -> Option<ChatMessage> {
  if parsed
    .payload
    .get("type")
    .and_then(|v| v.as_str())
    .is_some_and(|t| t == "token_count")
  {
    return None;
  }

  let ts = parsed
    .timestamp
    .as_deref()
    .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
    .map(|dt| dt.unix_timestamp());

  if let Some(role) = parsed.payload.get("role").and_then(|v| v.as_str()) {
    let content = parse_content(parsed.payload.get("content"));
    if content.trim().is_empty() {
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
    });
  }

  if let Some(message) = parsed.payload.get("message") {
    if let Some(role) = message.get("role").and_then(|v| v.as_str()) {
      let content = parse_content(message.get("content"));
      if content.trim().is_empty() {
        return None;
      }
      let mut tool_meta = extract_tool_meta_with_role(message, Some(role));
      tool_meta.merge(extract_tool_meta_with_role(&parsed.payload, Some(role)));
      return Some(ChatMessage {
        id: idx.to_string(),
        role: role.to_string(),
        content,
        timestamp: ts,
        tool_name: tool_meta.name,
        tool_call_id: tool_meta.call_id,
        tool_status: tool_meta.status,
      });
    }
  }

  if let Some(kind) = parsed.payload.get("type").and_then(|v| v.as_str()) {
    if matches!(kind, "assistant_message" | "user_message" | "message") {
      let role = if kind.starts_with("assistant") {
        "assistant"
      } else if kind.starts_with("user") {
        "user"
      } else {
        "assistant"
      };
      let content = parse_content(parsed.payload.get("content"));
      if content.trim().is_empty() {
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
      });
    }
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
  let is_toolish = type_hint
    .map(|value| value.contains("tool"))
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
    return true;
  }
  if payload
    .get("message")
    .and_then(|v| v.get("role"))
    .is_some()
  {
    return true;
  }
  if let Some(kind) = payload.get("type").and_then(|v| v.as_str()) {
    return matches!(kind, "assistant_message" | "user_message" | "message");
  }
  false
}
