use std::path::PathBuf;

use crate::errors::{AppError, AppResult};
use crate::models::{CodexCommandPreview, CodexCommandRequest, CodexRunOptions, Settings};

const ALLOWED_KINDS: [&str; 2] = ["new", "resume"];

pub fn build_command_preview(
  settings: &Settings,
  request: &CodexCommandRequest,
) -> AppResult<CodexCommandPreview> {
  if !ALLOWED_KINDS.contains(&request.kind.as_str()) {
    return Err(AppError::new(
      "codex_command",
      format!("Unsupported command kind: {}", request.kind),
    ));
  }

  let executable = resolve_executable(settings)?;
  let mut args: Vec<String> = Vec::new();
  let options = &request.options;

  match request.kind.as_str() {
    "resume" => {
      args.push("resume".to_string());
      push_global_flags(&mut args, options);
      if let Some(session_id) = request.session_id.as_ref() {
        if !session_id.trim().is_empty() {
          args.push(session_id.trim().to_string());
        } else {
          return Err(AppError::new("codex_command", "Session id is required."));
        }
      } else {
        return Err(AppError::new("codex_command", "Session id is required."));
      }
    }
    "new" => {
      push_global_flags(&mut args, options);
      if let Some(prompt) = options.prompt.as_ref() {
        if !prompt.trim().is_empty() {
          args.push(prompt.trim().to_string());
        }
      }
    }
    _ => {}
  }

  let display = format_command_display(&executable, &args);
  Ok(CodexCommandPreview {
    executable,
    args,
    display,
    cwd: options.cwd.clone().filter(|value| !value.trim().is_empty()),
  })
}

fn resolve_executable(settings: &Settings) -> AppResult<String> {
  if let Some(path) = settings.cli_path.as_ref() {
    let trimmed = path.trim();
    if !trimmed.is_empty() {
      return Ok(trimmed.to_string());
    }
  }
  Ok("codex".to_string())
}

fn push_global_flags(args: &mut Vec<String>, options: &CodexRunOptions) {
  if let Some(cwd) = options.cwd.as_ref().filter(|v| !v.trim().is_empty()) {
    args.push("--cd".to_string());
    args.push(cwd.trim().to_string());
  }
  if let Some(profile) = options.profile.as_ref().filter(|v| !v.trim().is_empty()) {
    args.push("--profile".to_string());
    args.push(profile.trim().to_string());
  }
  if let Some(model) = options.model.as_ref().filter(|v| !v.trim().is_empty()) {
    args.push("--model".to_string());
    args.push(model.trim().to_string());
  }
  if let Some(sandbox) = options.sandbox.as_ref().filter(|v| !v.trim().is_empty()) {
    args.push("--sandbox".to_string());
    args.push(sandbox.trim().to_string());
  }
  if let Some(approvals) = options.approvals.as_ref().filter(|v| !v.trim().is_empty()) {
    args.push("--ask-for-approval".to_string());
    args.push(approvals.trim().to_string());
  }
  if options.search.unwrap_or(false) {
    args.push("--search".to_string());
  }
}

fn format_command_display(executable: &str, args: &[String]) -> String {
  let mut parts = Vec::with_capacity(args.len() + 1);
  parts.push(shell_quote(executable));
  for arg in args {
    parts.push(shell_quote(arg));
  }
  parts.join(" ")
}

fn shell_quote(value: &str) -> String {
  if value.is_empty() {
    return "\"\"".to_string();
  }
  if value.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:\\".contains(c)) {
    return value.to_string();
  }
  let escaped = value.replace('"', "\\\"");
  format!("\"{}\"", escaped)
}

pub fn normalize_command_cwd(cwd: Option<String>) -> Option<PathBuf> {
  cwd.and_then(|value| {
    let trimmed = value.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(PathBuf::from(trimmed))
    }
  })
}
