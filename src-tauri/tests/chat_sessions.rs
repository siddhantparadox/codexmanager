use codex_manager::chat_sessions::{index_sessions, SessionIndexCache};
use std::path::Path;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[test]
fn parses_session_summary() {
  let fixtures = Path::new("tests/fixtures/sessions");
  let (sessions, stats) = index_sessions(fixtures, None).expect("index sessions");
  assert_eq!(stats.files_seen, 1);
  assert_eq!(stats.files_parsed, 1);
  assert_eq!(sessions.len(), 1);

  let summary = &sessions[0];
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
