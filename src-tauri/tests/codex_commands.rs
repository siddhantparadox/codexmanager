use codex_manager::codex_commands::build_command_preview;
use codex_manager::models::{CodexCommandRequest, CodexRunOptions, Settings};

fn base_settings() -> Settings {
  Settings {
    codex_home: "C:/Users/test/.codex".to_string(),
    repo_roots: Vec::new(),
    cli_path: None,
  }
}

#[test]
fn builds_resume_command_with_flags() {
  let request = CodexCommandRequest {
    kind: "resume".to_string(),
    session_id: Some("session-1".to_string()),
    options: CodexRunOptions {
      cwd: Some("C:/repo".to_string()),
      profile: Some("work".to_string()),
      model: Some("gpt-5-codex".to_string()),
      sandbox: Some("workspace-write".to_string()),
      approvals: Some("on-request".to_string()),
      search: Some(true),
      prompt: None,
    },
  };

  let preview = build_command_preview(&base_settings(), &request).expect("preview");
  assert_eq!(preview.executable, "codex");
  assert_eq!(
    preview.args,
    vec![
      "resume",
      "--cd",
      "C:/repo",
      "--profile",
      "work",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "on-request",
      "--search",
      "session-1"
    ]
  );
}

#[test]
fn builds_new_command_with_prompt() {
  let request = CodexCommandRequest {
    kind: "new".to_string(),
    session_id: None,
    options: CodexRunOptions {
      cwd: Some("C:/repo".to_string()),
      profile: None,
      model: Some("gpt-5-codex".to_string()),
      sandbox: Some("workspace-write".to_string()),
      approvals: None,
      search: Some(false),
      prompt: Some("Hello".to_string()),
    },
  };

  let preview = build_command_preview(&base_settings(), &request).expect("preview");
  assert_eq!(preview.executable, "codex");
  assert_eq!(
    preview.args,
    vec![
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "workspace-write",
      "Hello"
    ]
  );
}

#[test]
fn rejects_unknown_command_kind() {
  let request = CodexCommandRequest {
    kind: "invalid".to_string(),
    session_id: None,
    options: CodexRunOptions::default(),
  };

  let result = build_command_preview(&base_settings(), &request);
  assert!(result.is_err());
}
