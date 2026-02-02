use codex_manager::chat_sessions::{
  index_sessions, session_messages_latest, session_messages_page, SessionIndexCache,
};
use std::path::Path;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[test]
fn parses_session_summary() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (sessions, stats) = index_sessions(fixtures, None).expect("index sessions");
  assert_eq!(stats.files_seen, 4);
  assert_eq!(stats.files_parsed, 4);
  assert_eq!(sessions.len(), 4);

  let summary = sessions
    .iter()
    .find(|session| session.id == "basic")
    .expect("basic session summary");
  assert_eq!(summary.id, "basic");
  assert_eq!(summary.message_count, 2);
  assert_eq!(summary.last_model.as_deref(), Some("gpt-5-codex"));
  assert_eq!(summary.last_cwd.as_deref(), Some("C:/repo"));

  let first = OffsetDateTime::parse("2026-01-05T10:00:00Z", &Rfc3339)
    .unwrap()
    .unix_timestamp();
  let last = OffsetDateTime::parse("2026-01-05T10:00:07Z", &Rfc3339)
    .unwrap()
    .unix_timestamp();
  assert_eq!(summary.first_ts, Some(first));
  assert_eq!(summary.last_ts, Some(last));
}

#[test]
fn paging_returns_contiguous_slices() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (latest, total, cursor) =
    session_messages_latest(fixtures, "long", 2).expect("latest messages");
  assert_eq!(total, 5);
  assert_eq!(latest.len(), 2);
  assert_eq!(latest[0].content, "m4");
  assert_eq!(latest[1].content, "m5");
  let cursor = cursor.expect("cursor");

  let (older, _total, next_cursor) =
    session_messages_page(fixtures, "long", cursor, 2).expect("older messages");
  assert_eq!(older.len(), 2);
  assert_eq!(older[0].content, "m2");
  assert_eq!(older[1].content, "m3");

  let next_cursor = next_cursor.expect("next cursor");
  let (oldest, _total, final_cursor) =
    session_messages_page(fixtures, "long", next_cursor, 2).expect("oldest messages");
  assert_eq!(oldest.len(), 1);
  assert_eq!(oldest[0].content, "m1");
  assert!(final_cursor.is_none());
}

#[test]
fn index_sessions_on_empty_dir_returns_empty() {
  let temp = tempfile::tempdir().expect("tempdir");
  let (sessions, stats) = index_sessions(temp.path(), None).expect("index sessions");
  assert!(sessions.is_empty());
  assert_eq!(stats.files_seen, 0);
  assert_eq!(stats.files_parsed, 0);
}

#[test]
fn captures_tool_metadata() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (latest, _total, _cursor) =
    session_messages_latest(fixtures, "tool", 10).expect("latest messages");

  let assistant = latest
    .iter()
    .find(|message| message.role == "assistant")
    .expect("assistant message");
  assert_eq!(assistant.tool_name.as_deref(), Some("search"));
  assert_eq!(assistant.tool_call_id.as_deref(), Some("call_1"));

  let tool = latest
    .iter()
    .find(|message| message.role == "tool")
    .expect("tool message");
  assert_eq!(tool.tool_name.as_deref(), Some("search"));
  assert_eq!(tool.tool_call_id.as_deref(), Some("call_1"));
}

#[test]
fn cache_skips_unchanged_files() {
  let temp = tempfile::tempdir().expect("tempdir");
  let path = temp.path().join("session.jsonl");
  std::fs::write(
    &path,
    r#"{"timestamp":"2026-01-05T10:00:00Z","type":"event_msg","payload":{"role":"user","content":"hi"}}"#,
  )
  .expect("write");

  let mut cache = SessionIndexCache::default();
  let (sessions_first, stats_first) = index_sessions(temp.path(), Some(&mut cache)).unwrap();
  assert_eq!(sessions_first.len(), 1);
  assert_eq!(stats_first.files_parsed, 1);

  let (_sessions_second, stats_second) = index_sessions(temp.path(), Some(&mut cache)).unwrap();
  assert_eq!(stats_second.files_parsed, 0);

  std::fs::write(
    &path,
    r#"{"timestamp":"2026-01-05T10:00:00Z","type":"event_msg","payload":{"role":"user","content":"hi"}}
{"timestamp":"2026-01-05T10:00:01Z","type":"event_msg","payload":{"role":"assistant","content":"ok"}}"#,
  )
  .expect("write update");

  let (_sessions_third, stats_third) = index_sessions(temp.path(), Some(&mut cache)).unwrap();
  assert_eq!(stats_third.files_parsed, 1);
}

#[test]
fn loads_latest_messages_and_pages_older() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (latest, total, cursor) =
    session_messages_latest(fixtures, "basic", 1).expect("latest messages");
  assert_eq!(total, 4);
  assert_eq!(latest.len(), 1);
  assert_eq!(latest[0].role, "assistant");
  assert!(cursor.is_some());

  let (older, _total, next_cursor) =
    session_messages_page(fixtures, "basic", cursor.unwrap(), 10).expect("older messages");
  assert_eq!(older.len(), 3);
  assert_eq!(older[0].role, "meta");
  assert_eq!(older[1].role, "user");
  assert!(next_cursor.is_none());
}

#[test]
fn classifies_mixed_messages() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (latest, _total, _cursor) =
    session_messages_latest(fixtures, "mixed", 20).expect("latest messages");
  assert_eq!(latest.len(), 7);

  let reasoning = latest
    .iter()
    .find(|message| message.subtype.as_deref() == Some("agent_reasoning"))
    .expect("reasoning message");
  assert_eq!(reasoning.kind.as_deref(), Some("reasoning"));

  let tool_call = latest
    .iter()
    .find(|message| message.subtype.as_deref() == Some("function_call"))
    .expect("tool call");
  assert_eq!(tool_call.kind.as_deref(), Some("tool"));
  assert_eq!(tool_call.tool_name.as_deref(), Some("exec_command"));
  assert_eq!(tool_call.tool_call_id.as_deref(), Some("call_1"));

  let tool_output = latest
    .iter()
    .find(|message| message.subtype.as_deref() == Some("function_call_output"))
    .expect("tool output");
  assert_eq!(tool_output.kind.as_deref(), Some("tool"));
  assert_eq!(tool_output.tool_call_id.as_deref(), Some("call_1"));

  let developer = latest
    .iter()
    .find(|message| message.role == "developer")
    .expect("developer message");
  assert_eq!(developer.kind.as_deref(), Some("developer"));

  let meta = latest
    .iter()
    .find(|message| message.subtype.as_deref() == Some("session_meta"))
    .expect("session meta");
  assert_eq!(meta.kind.as_deref(), Some("meta"));
}

#[test]
fn session_meta_sets_workspace_when_turn_context_missing() {
  let temp = tempfile::tempdir().expect("tempdir");
  let path = temp.path().join("session.jsonl");
  std::fs::write(
    &path,
    r#"{"timestamp":"2026-02-02T01:43:48Z","type":"session_meta","payload":{"cwd":"C:/repo"}}
{"timestamp":"2026-02-02T01:43:49Z","type":"event_msg","payload":{"role":"user","content":"hi"}}"#,
  )
  .expect("write");

  let (sessions, _stats) = index_sessions(temp.path(), None).expect("index sessions");
  assert_eq!(sessions.len(), 1);
  assert_eq!(sessions[0].last_cwd.as_deref(), Some("C:/repo"));
}

#[test]
fn system_messages_are_filtered_from_transcript_and_counts() {
  let temp = tempfile::tempdir().expect("tempdir");
  let path = temp.path().join("session.jsonl");
  std::fs::write(
    &path,
    r#"{"timestamp":"2026-02-02T01:43:48Z","type":"event_msg","payload":{"role":"system","content":"sys"}}
{"timestamp":"2026-02-02T01:43:49Z","type":"event_msg","payload":{"role":"user","content":"hi"}}"#,
  )
  .expect("write");

  let (latest, total, _cursor) =
    session_messages_latest(temp.path(), "session", 10).expect("latest messages");
  assert_eq!(total, 1);
  assert_eq!(latest.len(), 1);
  assert_eq!(latest[0].role, "user");

  let (sessions, _stats) = index_sessions(temp.path(), None).expect("index sessions");
  assert_eq!(sessions.len(), 1);
  assert_eq!(sessions[0].message_count, 1);
}

#[test]
fn index_sessions_on_missing_dir_returns_empty() {
  let temp = tempfile::tempdir().expect("tempdir");
  let missing = temp.path().join("missing");
  let (sessions, stats) = index_sessions(&missing, None).expect("index sessions");
  assert!(sessions.is_empty());
  assert_eq!(stats.files_seen, 0);
  assert_eq!(stats.files_parsed, 0);
}
