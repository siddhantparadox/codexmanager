use serde::Deserialize;
use serde_json::Value;
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionSummary {
  pub id: String,
  pub first_ts: Option<i64>,
  pub last_ts: Option<i64>,
  pub message_count: u64,
  pub last_model: Option<String>,
  pub last_cwd: Option<String>,
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
