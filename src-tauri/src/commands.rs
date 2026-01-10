use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, State};

use crate::errors::{AppError, AppResult};
use crate::fs;
use crate::models::{
  ApplyResult, ChangeRequest, ConfigText, Diagnostic, PreviewFile, PreviewResult, ScanState,
  Settings, SkillScope, UserConfigSummary,
};
use crate::paths::{
  config_path, is_within_root, repo_skills_root, resolve_codex_home, sanitize_config_name,
  sanitize_skill_name, user_skills_root, AppPaths,
};
use crate::state::{load_settings, normalize_settings, save_settings, AppState};
use crate::toml_patch;
use similar::TextDiff;

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<Mutex<AppState>>) -> AppResult<Settings> {
  let settings = load_settings(&app)?;
  let mut guard = state.lock().map_err(|_| AppError::new("state", "State lock failed"))?;
  guard.settings = settings.clone();
  Ok(settings)
}

#[tauri::command]
pub fn update_settings(
  app: AppHandle,
  state: State<Mutex<AppState>>,
  settings: Settings,
) -> AppResult<Settings> {
  let normalized = normalize_settings(settings);
  save_settings(&app, &normalized)?;
  let mut guard = state.lock().map_err(|_| AppError::new("state", "State lock failed"))?;
  guard.settings = normalized.clone();
  Ok(normalized)
}

#[tauri::command]
pub fn scan_state(app: AppHandle, state: State<Mutex<AppState>>) -> AppResult<ScanState> {
  let settings = ensure_settings(&app, &state)?;
  let codex_home = resolve_codex_home(&settings)?;
  let config_path = config_path(&codex_home);
  let config = fs::scan_config(&config_path);

  let repo_roots: Vec<PathBuf> = settings
    .repo_roots
    .iter()
    .map(PathBuf::from)
    .collect();
  let skills = fs::scan_skills(&user_skills_root(&codex_home), &repo_roots);

  let mut diagnostics = Vec::new();
  if !codex_home.exists() {
    diagnostics.push(Diagnostic {
      level: "warn".to_string(),
      message: "CODEX_HOME does not exist".to_string(),
      path: Some(codex_home.to_string_lossy().to_string()),
    });
  }
  if let Some(error) = &config.parse_error {
    diagnostics.push(Diagnostic {
      level: "error".to_string(),
      message: error.clone(),
      path: Some(config.path.clone()),
    });
  }

  let paths = AppPaths::from_app(&app)?;
  let backups = fs::list_backups(&paths.backups_dir())?;

  Ok(ScanState {
    settings,
    config,
    skills,
    diagnostics,
    backups,
  })
}

#[tauri::command]
pub fn read_config_text(app: AppHandle, state: State<Mutex<AppState>>) -> AppResult<ConfigText> {
  let settings = ensure_settings(&app, &state)?;
  let codex_home = resolve_codex_home(&settings)?;
  let path = config_path(&codex_home);
  if !path.exists() {
    return Err(AppError::new("config_missing", "config.toml not found"));
  }
  let text = fs::read_text_file(&path)?;
  let redacted = toml_patch::redact_toml(&text)?;
  Ok(ConfigText {
    text: redacted,
    redacted: toml_patch::contains_sensitive_keys(&text),
  })
}

#[tauri::command]
pub fn read_skill_text(
  app: AppHandle,
  state: State<Mutex<AppState>>,
  path: String,
) -> AppResult<String> {
  let settings = ensure_settings(&app, &state)?;
  let path = PathBuf::from(path);
  if !is_allowed_skill_path(&settings, &path) {
    return Err(AppError::new("path_denied", "Skill path not allowed"));
  }
  fs::read_text_file(&path)
}

#[tauri::command]
pub fn list_user_configs(app: AppHandle) -> AppResult<Vec<UserConfigSummary>> {
  let paths = AppPaths::from_app(&app)?;
  fs::list_user_configs(&paths.user_configs_dir())
}

#[tauri::command]
pub fn read_user_config_text(app: AppHandle, name: String) -> AppResult<ConfigText> {
  let paths = AppPaths::from_app(&app)?;
  let path = user_config_path(&paths, &name)?;
  if !path.exists() {
    return Err(AppError::new("config_missing", "Saved config not found"));
  }
  let text = fs::read_text_file(&path)?;
  let redacted = toml_patch::redact_toml(&text)?;
  Ok(ConfigText {
    text: redacted,
    redacted: toml_patch::contains_sensitive_keys(&text),
  })
}

#[tauri::command]
pub fn preview_change(
  app: AppHandle,
  state: State<Mutex<AppState>>,
  change: ChangeRequest,
) -> AppResult<PreviewResult> {
  let settings = ensure_settings(&app, &state)?;
  let plan = build_change_plan(&app, &settings, change)?;
  let diff = build_plan_diff(&plan)?;
  let files = plan
    .files
    .iter()
    .map(|file| PreviewFile {
      path: file.path.to_string_lossy().to_string(),
      exists: file.before.is_some(),
    })
    .collect();

  Ok(PreviewResult {
    operation: plan.operation,
    diff,
    warnings: plan.warnings,
    files,
  })
}

#[tauri::command]
pub fn apply_change(
  app: AppHandle,
  state: State<Mutex<AppState>>,
  change: ChangeRequest,
) -> AppResult<ApplyResult> {
  let settings = ensure_settings(&app, &state)?;
  let plan = build_change_plan(&app, &settings, change)?;
  let paths = AppPaths::from_app(&app)?;
  let file_paths: Vec<PathBuf> = plan.files.iter().map(|file| file.path.clone()).collect();
  let backup = fs::create_backup(&paths.backups_dir(), &plan.operation, &file_paths)?;

  let apply_result = apply_plan(&plan);
  if let Err(error) = apply_result {
    let _ = fs::restore_backup(&paths.backups_dir(), &backup.id);
    return Err(error);
  }

  if plan.validate_config {
    let config_path = config_path(&resolve_codex_home(&settings)?);
    let text = fs::read_text_file(&config_path)?;
    let parse_result: Result<toml::Value, _> = text.parse();
    if let Err(error) = parse_result {
      let _ = fs::restore_backup(&paths.backups_dir(), &backup.id);
      return Err(AppError::new("toml_parse", error.to_string()));
    }
  }

  Ok(ApplyResult {
    backup_id: Some(backup.id),
    operation: plan.operation,
  })
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> AppResult<Vec<crate::models::BackupSummary>> {
  let paths = AppPaths::from_app(&app)?;
  fs::list_backups(&paths.backups_dir())
}

struct ChangePlan {
  operation: String,
  files: Vec<FileChange>,
  warnings: Vec<String>,
  validate_config: bool,
}

struct FileChange {
  path: PathBuf,
  before: Option<String>,
  after: Option<String>,
  redact: bool,
}

fn build_change_plan(
  app: &AppHandle,
  settings: &Settings,
  change: ChangeRequest,
) -> AppResult<ChangePlan> {
  let codex_home = resolve_codex_home(settings)?;
  let config_path = config_path(&codex_home);

  match change {
    ChangeRequest::ToggleMcpServer { name, enabled } => {
      ensure_config_exists(&config_path)?;
      let before = fs::read_text_file(&config_path)?;
      let after = toml_patch::set_mcp_enabled(&before, &name, enabled)?;
      Ok(single_file_plan(
        "toggle_mcp_server",
        config_path,
        before,
        after,
        true,
        true,
      ))
    }
    ChangeRequest::SetConfigScalar { key, value } => {
      ensure_config_exists(&config_path)?;
      let before = fs::read_text_file(&config_path)?;
      let after = toml_patch::set_root_scalar(&before, &key, value)?;
      Ok(single_file_plan(
        "set_config_scalar",
        config_path,
        before,
        after,
        true,
        true,
      ))
    }
    ChangeRequest::ReplaceConfig { content } => {
      let before = if config_path.exists() {
        Some(fs::read_text_file(&config_path)?)
      } else {
        None
      };
      let merged = if let Some(existing) = before.as_deref() {
        toml_patch::merge_sensitive_values(existing, &content)?
      } else {
        content
      };
      let mut warnings = Vec::new();
      if before
        .as_deref()
        .map(toml_patch::contains_sensitive_keys)
        .unwrap_or(false)
      {
        warnings.push("Sensitive values preserved on apply.".to_string());
      }
      let _: toml::Value = merged.parse()?;
      Ok(ChangePlan {
        operation: "replace_config".to_string(),
        files: vec![FileChange {
          path: config_path,
          before,
          after: Some(merged),
          redact: true,
        }],
        warnings,
        validate_config: true,
      })
    }
    ChangeRequest::UpsertMcpServer { name, table_toml } => {
      ensure_config_exists(&config_path)?;
      let before = fs::read_text_file(&config_path)?;
      let after = toml_patch::upsert_mcp_server(&before, &name, &table_toml)?;
      Ok(single_file_plan(
        "upsert_mcp_server",
        config_path,
        before,
        after,
        true,
        true,
      ))
    }
    ChangeRequest::DeleteMcpServer { name } => {
      ensure_config_exists(&config_path)?;
      let before = fs::read_text_file(&config_path)?;
      let after = toml_patch::delete_mcp_server(&before, &name)?;
      Ok(single_file_plan(
        "delete_mcp_server",
        config_path,
        before,
        after,
        true,
        true,
      ))
    }
    ChangeRequest::CreateSkill {
      scope,
      repo_root,
      name,
      content,
    } => {
      let path = build_skill_path(settings, &codex_home, &scope, repo_root, &name)?;
      let before = if path.exists() {
        Some(fs::read_text_file(&path)?)
      } else {
        None
      };
      Ok(ChangePlan {
        operation: "create_skill".to_string(),
        files: vec![FileChange {
          path,
          before,
          after: Some(content),
          redact: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
      })
    }
    ChangeRequest::UpdateSkill { path, content } => {
      let path = PathBuf::from(path);
      if !is_allowed_skill_path(settings, &path) {
        return Err(AppError::new("path_denied", "Skill path not allowed"));
      }
      let before = fs::read_text_file(&path)?;
      Ok(ChangePlan {
        operation: "update_skill".to_string(),
        files: vec![FileChange {
          path,
          before: Some(before),
          after: Some(content),
          redact: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
      })
    }
    ChangeRequest::DeleteSkill { path } => {
      let path = PathBuf::from(path);
      if !is_allowed_skill_path(settings, &path) {
        return Err(AppError::new("path_denied", "Skill path not allowed"));
      }
      let before = fs::read_text_file(&path)?;
      Ok(ChangePlan {
        operation: "delete_skill".to_string(),
        files: vec![FileChange {
          path,
          before: Some(before),
          after: None,
          redact: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
      })
    }
    ChangeRequest::SaveUserConfig { name, content } => {
      let paths = AppPaths::from_app(app)?;
      let path = user_config_path(&paths, &name)?;
      let before = if path.exists() {
        Some(fs::read_text_file(&path)?)
      } else {
        None
      };
      let merged = if let Some(existing) = before.as_deref() {
        toml_patch::merge_sensitive_values(existing, &content)?
      } else {
        content
      };
      let mut warnings = Vec::new();
      if before
        .as_deref()
        .map(toml_patch::contains_sensitive_keys)
        .unwrap_or(false)
      {
        warnings.push("Sensitive values preserved on save.".to_string());
      }
      let _: toml::Value = merged.parse()?;
      Ok(ChangePlan {
        operation: "save_user_config".to_string(),
        files: vec![FileChange {
          path,
          before,
          after: Some(merged),
          redact: true,
        }],
        warnings,
        validate_config: false,
      })
    }
    ChangeRequest::DeleteUserConfig { name } => {
      let paths = AppPaths::from_app(app)?;
      let path = user_config_path(&paths, &name)?;
      if !path.exists() {
        return Err(AppError::new("config_missing", "Saved config not found"));
      }
      let before = fs::read_text_file(&path)?;
      Ok(ChangePlan {
        operation: "delete_user_config".to_string(),
        files: vec![FileChange {
          path,
          before: Some(before),
          after: None,
          redact: true,
        }],
        warnings: Vec::new(),
        validate_config: false,
      })
    }
    ChangeRequest::RestoreBackup { backup_id } => {
      let paths = AppPaths::from_app(app)?;
      let manifest = fs::load_backup_manifest(&paths.backups_dir(), &backup_id)?;
      let mut files = Vec::new();
      let mut validate_config = false;
      for file in manifest.files {
        let target = PathBuf::from(&file.path);
        let before = if target.exists() {
          Some(fs::read_text_file(&target)?)
        } else {
          None
        };
        let after = match &file.backup_path {
          Some(backup_path) => Some(fs::read_text_file(Path::new(backup_path))?),
          None => None,
        };
        let redact = should_redact_toml(&target, &paths.user_configs_dir());
        if redact && target.file_name().and_then(|name| name.to_str()) == Some("config.toml") {
          validate_config = true;
        }
        files.push(FileChange {
          path: target,
          before,
          after,
          redact,
        });
      }
      Ok(ChangePlan {
        operation: format!("restore_backup:{}", backup_id),
        files,
        warnings: Vec::new(),
        validate_config,
      })
    }
  }
}

fn build_skill_path(
  settings: &Settings,
  codex_home: &Path,
  scope: &SkillScope,
  repo_root: Option<String>,
  name: &str,
) -> AppResult<PathBuf> {
  let slug = sanitize_skill_name(name)?;
  let root = match scope {
    SkillScope::User => user_skills_root(codex_home),
    SkillScope::Repo => {
      let repo_root = repo_root.ok_or_else(|| {
        AppError::new("repo_root", "Repo scope requires repo_root")
      })?;
      if !settings.repo_roots.contains(&repo_root) {
        return Err(AppError::new("repo_root", "Repo root not registered"));
      }
      repo_skills_root(Path::new(&repo_root))
    }
  };
  Ok(root.join(slug).join("SKILL.md"))
}

fn build_plan_diff(plan: &ChangePlan) -> AppResult<String> {
  let mut output = String::new();
  for file in &plan.files {
    let before = file.before.as_deref().unwrap_or("");
    let after = file.after.as_deref().unwrap_or("");
    let (before_text, after_text) = if file.redact {
      (
        toml_patch::redact_toml(before)?,
        toml_patch::redact_toml(after)?,
      )
    } else {
      (before.to_string(), after.to_string())
    };

    let diff = TextDiff::from_lines(&before_text, &after_text)
      .unified_diff()
      .header(
        &format!("a/{}", file.path.to_string_lossy()),
        &format!("b/{}", file.path.to_string_lossy()),
      )
      .to_string();
    if !diff.is_empty() {
      output.push_str(&diff);
      output.push('\n');
    }
  }
  Ok(output.trim().to_string())
}

fn apply_plan(plan: &ChangePlan) -> AppResult<()> {
  for file in &plan.files {
    match &file.after {
      Some(content) => {
        fs::write_atomic(&file.path, content)?;
      }
      None => {
        if file.path.exists() {
          std::fs::remove_file(&file.path)?;
        }
      }
    }
  }
  Ok(())
}

fn ensure_config_exists(path: &Path) -> AppResult<()> {
  if !path.exists() {
    return Err(AppError::new("config_missing", "config.toml not found"));
  }
  Ok(())
}

fn user_config_path(paths: &AppPaths, name: &str) -> AppResult<PathBuf> {
  let slug = sanitize_config_name(name)?;
  Ok(paths.user_configs_dir().join(format!("{}.toml", slug)))
}

fn should_redact_toml(path: &Path, user_configs_dir: &Path) -> bool {
  let is_config = path
    .file_name()
    .and_then(|name| name.to_str())
    .map(|name| name.eq_ignore_ascii_case("config.toml"))
    .unwrap_or(false);
  is_config || path.starts_with(user_configs_dir)
}

fn is_allowed_skill_path(settings: &Settings, path: &Path) -> bool {
  if let Ok(codex_home) = resolve_codex_home(settings) {
    let user_root = user_skills_root(&codex_home);
    if is_within_root(&user_root, path) {
      return true;
    }
  }
  for repo_root in &settings.repo_roots {
    let root = repo_skills_root(Path::new(repo_root));
    if is_within_root(&root, path) {
      return true;
    }
  }
  false
}

fn ensure_settings(app: &AppHandle, state: &State<Mutex<AppState>>) -> AppResult<Settings> {
  let guard = state.lock().map_err(|_| AppError::new("state", "State lock failed"))?;
  if !guard.settings.codex_home.is_empty() {
    return Ok(guard.settings.clone());
  }
  drop(guard);
  let settings = load_settings(app)?;
  let mut guard = state.lock().map_err(|_| AppError::new("state", "State lock failed"))?;
  guard.settings = settings.clone();
  Ok(settings)
}

fn single_file_plan(
  operation: &str,
  path: PathBuf,
  before: String,
  after: String,
  validate_config: bool,
  redact: bool,
) -> ChangePlan {
  ChangePlan {
    operation: operation.to_string(),
    files: vec![FileChange {
      path,
      before: Some(before),
      after: Some(after),
      redact,
    }],
    warnings: Vec::new(),
    validate_config,
  }
}
