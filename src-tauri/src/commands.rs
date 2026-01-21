use std::collections::HashSet;
use std::fs as std_fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use rfd::FileDialog;
use tauri::{AppHandle, State};

use crate::errors::{AppError, AppResult};
use crate::fs;
use crate::chat_sessions;
use crate::models::{
  ApplyResult, ChangeRequest, ChatSessionSummary, ChatSessionsResponse, ConfigText, Diagnostic,
  InstallMode, PreviewFile, PreviewResult, RemoteSkillDetail, RemoteSkillPage, ScanState, Settings,
  SkillFileEntry, SkillFolderSpec, SkillScope, UserConfigSummary,
};
use crate::paths::{
  config_path, is_within_root, repo_skills_root, resolve_codex_home, sanitize_config_name,
  sanitize_skill_name, user_skills_root, AppPaths,
};
use crate::state::{load_settings, normalize_settings, save_settings, AppState};
use crate::skills_registry;
use crate::toml_patch;
use similar::TextDiff;
use walkdir::WalkDir;

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
pub fn chat_sessions_list(app: AppHandle, state: State<Mutex<AppState>>) -> AppResult<ChatSessionsResponse> {
  let settings = ensure_settings(&app, &state)?;
  let codex_home = resolve_codex_home(&settings)?;
  let sessions_dir = codex_home.join("sessions");
  let sessions_dir_exists = sessions_dir.is_dir();
  let sessions_path = sessions_dir.to_string_lossy().to_string();

  let mut guard = state.lock().map_err(|_| AppError::new("state", "State lock failed"))?;
  let (sessions, stats) = chat_sessions::index_sessions(&sessions_dir, Some(&mut guard.chat_cache))?;

  let summaries = sessions
    .into_iter()
    .map(|session| ChatSessionSummary {
      id: session.id,
      first_ts: session.first_ts,
      last_ts: session.last_ts,
      message_count: session.message_count,
      last_model: session.last_model,
      last_cwd: session.last_cwd,
    })
    .collect();

  Ok(ChatSessionsResponse {
    sessions_path,
    sessions_dir_exists,
    sessions: summaries,
    files_seen: stats.files_seen,
    files_parsed: stats.files_parsed,
    parse_errors: stats.parse_errors,
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
  let (parsed, parse_error) = parse_toml_json(&text);
  Ok(ConfigText {
    text,
    redacted: false,
    parsed,
    parse_error,
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
pub fn list_skill_files(
  app: AppHandle,
  state: State<Mutex<AppState>>,
  dir: String,
) -> AppResult<Vec<SkillFileEntry>> {
  let settings = ensure_settings(&app, &state)?;
  let path = PathBuf::from(dir);
  if !is_allowed_skill_path(&settings, &path) {
    return Err(AppError::new("path_denied", "Skill path not allowed"));
  }
  fs::list_skill_files(&path)
}

#[tauri::command]
pub fn fetch_public_skill(
  _app: AppHandle,
  _state: State<Mutex<AppState>>,
  slug: String,
) -> AppResult<RemoteSkillDetail> {
  skills_registry::fetch_skill_detail(&slug)
}

#[tauri::command]
pub fn list_public_skills(
  _app: AppHandle,
  _state: State<Mutex<AppState>>,
  query: Option<String>,
  cursor: Option<String>,
  limit: Option<usize>,
) -> AppResult<RemoteSkillPage> {
  let limit = limit.unwrap_or(10).clamp(1, 50);
  let cursor = cursor.as_deref();
  if let Some(value) = query {
    if !value.trim().is_empty() {
      return skills_registry::search_skills(&value, limit, cursor);
    }
  }
  skills_registry::list_skills(limit, cursor)
}

#[tauri::command]
pub fn list_user_configs(app: AppHandle) -> AppResult<Vec<UserConfigSummary>> {
  let paths = AppPaths::from_app(&app)?;
  fs::list_user_configs(&paths.user_configs_dir())
}

#[tauri::command]
pub fn export_wrapped_png(
  data_url: String,
  suggested_name: Option<String>,
) -> AppResult<Option<String>> {
  let data = data_url
    .strip_prefix("data:image/png;base64,")
    .ok_or_else(|| AppError::new("export_format", "Expected PNG data URL"))?;
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(data)
    .map_err(|err| AppError::new("export_decode", format!("Decode failed: {}", err)))?;

  let mut dialog = FileDialog::new().add_filter("PNG Image", &["png"]);
  if let Some(name) = suggested_name.filter(|value| !value.trim().is_empty()) {
    let file_name = if name.to_lowercase().ends_with(".png") {
      name
    } else {
      format!("{}.png", name)
    };
    dialog = dialog.set_file_name(file_name);
  }

  let Some(path) = dialog.save_file() else {
    return Ok(None);
  };

  fs::write_atomic_bytes(&path, &bytes)?;
  Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn read_user_config_text(app: AppHandle, name: String) -> AppResult<ConfigText> {
  let paths = AppPaths::from_app(&app)?;
  let path = user_config_path(&paths, &name)?;
  if !path.exists() {
    return Err(AppError::new("config_missing", "Saved config not found"));
  }
  let text = fs::read_text_file(&path)?;
  let (parsed, parse_error) = parse_toml_json(&text);
  Ok(ConfigText {
    text,
    redacted: false,
    parsed,
    parse_error,
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
    cleanup_created_dirs(&plan.create_dirs);
    return Err(error);
  }

  if plan.validate_config {
    let config_path = config_path(&resolve_codex_home(&settings)?);
    let text = fs::read_text_file(&config_path)?;
    let parse_result: Result<toml::Value, _> = text.parse();
    if let Err(error) = parse_result {
      let _ = fs::restore_backup(&paths.backups_dir(), &backup.id);
      cleanup_created_dirs(&plan.create_dirs);
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

#[tauri::command]
pub fn delete_backup(app: AppHandle, id: String) -> AppResult<()> {
  let paths = AppPaths::from_app(&app)?;
  fs::delete_backup(&paths.backups_dir(), &id)
}

#[tauri::command]
pub fn delete_all_backups(app: AppHandle) -> AppResult<()> {
  let paths = AppPaths::from_app(&app)?;
  fs::delete_all_backups(&paths.backups_dir())
}

struct ChangePlan {
  operation: String,
  files: Vec<FileChange>,
  warnings: Vec<String>,
  validate_config: bool,
  create_dirs: Vec<PathBuf>,
  remove_dirs_before: Vec<PathBuf>,
  remove_dirs: Vec<PathBuf>,
}

struct FileChange {
  path: PathBuf,
  before: Option<String>,
  after: Option<String>,
  after_bytes: Option<Vec<u8>>,
  redact: bool,
  binary: bool,
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
        false,
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
        false,
      ))
    }
    ChangeRequest::SetConfigPath { path, value } => {
      ensure_config_exists(&config_path)?;
      let before = fs::read_text_file(&config_path)?;
      let after = toml_patch::set_value_at_path(&before, &path, value)?;
      Ok(single_file_plan(
        "set_config_path",
        config_path,
        before,
        after,
        true,
        false,
      ))
    }
    ChangeRequest::ReplaceConfig { content } => {
      let before = if config_path.exists() {
        Some(fs::read_text_file(&config_path)?)
      } else {
        None
      };
      let _: toml::Value = content.parse()?;
      Ok(ChangePlan {
        operation: "replace_config".to_string(),
        files: vec![FileChange {
          path: config_path,
          before,
          after: Some(content),
          after_bytes: None,
          redact: false,
          binary: false,
        }],
        warnings: Vec::new(),
        validate_config: true,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
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
        false,
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
        false,
      ))
    }
    ChangeRequest::CreateSkill {
      scope,
      repo_root,
      name,
      content,
      folders,
    } => {
      let path = build_skill_path(settings, &codex_home, &scope, repo_root, &name)?;
      let skill_dir = path.parent().map(|dir| dir.to_path_buf());
      let before = if path.exists() {
        Some(fs::read_text_file(&path)?)
      } else {
        None
      };
      let mut warnings = Vec::new();
      let mut create_dirs = Vec::new();
      let mut files = vec![FileChange {
        path,
        before,
        after: Some(content),
        after_bytes: None,
        redact: false,
        binary: false,
      }];
      if let Some(skill_dir) = skill_dir.as_ref() {
        append_folder_plan(
          skill_dir,
          "scripts",
          &folders.scripts,
          &mut files,
          &mut create_dirs,
          &mut warnings,
        )?;
        append_folder_plan(
          skill_dir,
          "references",
          &folders.references,
          &mut files,
          &mut create_dirs,
          &mut warnings,
        )?;
        append_folder_plan(
          skill_dir,
          "assets",
          &folders.assets,
          &mut files,
          &mut create_dirs,
          &mut warnings,
        )?;
      }
      Ok(ChangePlan {
        operation: "create_skill".to_string(),
        files,
        warnings,
        validate_config: false,
        create_dirs,
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
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
          after_bytes: None,
          redact: false,
          binary: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
      })
    }
    ChangeRequest::DeleteSkill { path } => {
      let path = PathBuf::from(path);
      if !is_allowed_skill_path(settings, &path) {
        return Err(AppError::new("path_denied", "Skill path not allowed"));
      }
      if !path.exists() {
        return Ok(ChangePlan {
          operation: "delete_skill".to_string(),
          files: vec![FileChange {
            path,
            before: None,
            after: None,
            after_bytes: None,
            redact: false,
            binary: false,
          }],
          warnings: vec!["File not found; nothing to delete.".to_string()],
          validate_config: false,
          create_dirs: Vec::new(),
          remove_dirs_before: Vec::new(),
          remove_dirs: Vec::new(),
        });
      }
      let (before, binary) = read_text_or_binary(&path)?;
      Ok(ChangePlan {
        operation: "delete_skill".to_string(),
        files: vec![FileChange {
          path,
          before,
          after: None,
          after_bytes: None,
          redact: false,
          binary,
        }],
        warnings: Vec::new(),
        validate_config: false,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
      })
    }
    ChangeRequest::DeleteSkillFolder { dir } => {
      let path = PathBuf::from(dir);
      if !is_allowed_skill_path(settings, &path) {
        return Err(AppError::new("path_denied", "Skill path not allowed"));
      }
      if !path.exists() || !path.is_dir() {
        return Err(AppError::new("skill_missing", "Skill directory not found"));
      }
      if !path.join("SKILL.md").exists() {
        return Err(AppError::new(
          "skill_invalid",
          "SKILL.md not found in skill directory",
        ));
      }
      let mut files = Vec::new();
      for file_path in collect_skill_files(&path)? {
        let (before, binary) = read_text_or_binary(&file_path)?;
        files.push(FileChange {
          path: file_path,
          before,
          after: None,
          after_bytes: None,
          redact: false,
          binary,
        });
      }
      Ok(ChangePlan {
        operation: "delete_skill_folder".to_string(),
        files,
        warnings: Vec::new(),
        validate_config: false,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: vec![path],
      })
    }
    ChangeRequest::InstallRemoteSkill {
      slug,
      scope,
      repo_root,
      mode,
    } => {
      let slug_trim = slug.trim();
      if slug_trim.is_empty() {
        return Err(AppError::new("skill_slug", "Skill slug cannot be empty"));
      }
      let zip_bytes = skills_registry::download_latest_zip(slug_trim)?;
      build_install_remote_skill_plan(
        settings,
        &codex_home,
        slug_trim,
        scope,
        repo_root,
        mode,
        zip_bytes,
      )
    }
    ChangeRequest::SaveUserConfig { name, content } => {
      let paths = AppPaths::from_app(app)?;
      let path = user_config_path(&paths, &name)?;
      let before = if path.exists() {
        Some(fs::read_text_file(&path)?)
      } else {
        None
      };
      let _: toml::Value = content.parse()?;
      Ok(ChangePlan {
        operation: "save_user_config".to_string(),
        files: vec![FileChange {
          path,
          before,
          after: Some(content),
          after_bytes: None,
          redact: false,
          binary: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
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
          after_bytes: None,
          redact: false,
          binary: false,
        }],
        warnings: Vec::new(),
        validate_config: false,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
      })
    }
    ChangeRequest::RestoreBackup { backup_id } => {
      let paths = AppPaths::from_app(app)?;
      let manifest = fs::load_backup_manifest(&paths.backups_dir(), &backup_id)?;
      let mut files = Vec::new();
      let mut validate_config = false;
      for file in manifest.files {
        let target = PathBuf::from(&file.path);
        let (before, _before_bytes, before_binary) = if target.exists() {
          read_text_or_binary_bytes(&target)?
        } else {
          (None, None, false)
        };
        let (after, after_bytes, after_binary) = match &file.backup_path {
          Some(backup_path) => read_text_or_binary_bytes(Path::new(backup_path))?,
          None => (None, None, false),
        };
        let redact = should_redact_toml(&target, &paths.user_configs_dir());
        let is_config = target
          .file_name()
          .and_then(|name| name.to_str())
          .map(|name| name.eq_ignore_ascii_case("config.toml"))
          .unwrap_or(false);
        let binary = before_binary || after_binary;
        if is_config {
          validate_config = true;
        }
        files.push(FileChange {
          path: target,
          before,
          after,
          after_bytes: if after_binary { after_bytes } else { None },
          redact,
          binary,
        });
      }
      Ok(ChangePlan {
        operation: format!("restore_backup:{}", backup_id),
        files,
        warnings: Vec::new(),
        validate_config,
        create_dirs: Vec::new(),
        remove_dirs_before: Vec::new(),
        remove_dirs: Vec::new(),
      })
    }
  }
}

fn build_install_remote_skill_plan(
  settings: &Settings,
  codex_home: &Path,
  slug: &str,
  scope: SkillScope,
  repo_root: Option<String>,
  mode: InstallMode,
  zip_bytes: Vec<u8>,
) -> AppResult<ChangePlan> {
  let slug_trim = slug.trim();
  if slug_trim.is_empty() {
    return Err(AppError::new("skill_slug", "Skill slug cannot be empty"));
  }
  let mut warnings = Vec::new();
  warnings.push(
    "Remote package is fetched again on apply; preview may change if the registry updates."
      .to_string(),
  );
  let safe_slug = sanitize_skill_name(slug_trim)?;
  if safe_slug != slug_trim {
    warnings.push(format!("Local folder will be named '{}'.", safe_slug));
  }
  let root = match scope {
    SkillScope::User => user_skills_root(codex_home),
    SkillScope::Repo => {
      let repo_root = repo_root
        .ok_or_else(|| AppError::new("repo_root", "Repo scope requires repo_root"))?;
      if !settings.repo_roots.contains(&repo_root) {
        return Err(AppError::new("repo_root", "Repo root not registered"));
      }
      repo_skills_root(Path::new(&repo_root))
    }
  };
  let target_dir = root.join(&safe_slug);
  if !is_within_root(&root, &target_dir) {
    return Err(AppError::new("path_denied", "Target path not allowed"));
  }

  let entries = skills_registry::extract_zip_entries(&zip_bytes)?;
  if entries.is_empty() {
    return Err(AppError::new("zip_empty", "No files found in skill package"));
  }

  let mut files = Vec::new();
  let mut new_paths: HashSet<PathBuf> = HashSet::new();
  let mut has_skill_md = false;

  for entry in entries {
    if entry
      .path
      .file_name()
      .and_then(|name| name.to_str())
      .map(|name| name.eq_ignore_ascii_case("SKILL.md"))
      == Some(true)
    {
      has_skill_md = true;
    }
    let target_path = target_dir.join(&entry.path);
    if new_paths.contains(&target_path) {
      warnings.push(format!(
        "Duplicate entry skipped: {}",
        entry.path.to_string_lossy()
      ));
      continue;
    }
    let (before, before_binary) = if target_path.exists() {
      read_text_or_binary(&target_path)?
    } else {
      (None, false)
    };
    let change = build_change_from_bytes(target_path.clone(), entry.bytes, before, before_binary);
    files.push(change);
    new_paths.insert(target_path);
  }

  if !has_skill_md {
    warnings.push("Package does not include SKILL.md.".to_string());
  }

  let mut remove_dirs_before = Vec::new();
  match &mode {
    InstallMode::Overlay => {}
    InstallMode::Replace => {
      warnings.push("Replace mode removes the existing skill folder before install.".to_string());
      if target_dir.exists() {
        remove_dirs_before.push(target_dir.clone());
      }
      let mut deletions = Vec::new();
      if target_dir.exists() {
        for existing in collect_skill_files(&target_dir)? {
          let (before, binary) = read_text_or_binary(&existing)?;
          deletions.push(FileChange {
            path: existing,
            before,
            after: None,
            after_bytes: None,
            redact: false,
            binary,
          });
        }
      }
      deletions.append(&mut files);
      files = deletions;
    }
    InstallMode::Sync => {
      warnings.push("Sync mode deletes local files not present in the package.".to_string());
      if target_dir.exists() {
        for existing in collect_skill_files(&target_dir)? {
          if new_paths.contains(&existing) {
            continue;
          }
          let (before, binary) = read_text_or_binary(&existing)?;
          files.push(FileChange {
            path: existing,
            before,
            after: None,
            after_bytes: None,
            redact: false,
            binary,
          });
        }
      }
    }
  }

  let mode_label = match mode {
    InstallMode::Overlay => "overlay",
    InstallMode::Replace => "replace",
    InstallMode::Sync => "sync",
  };
  Ok(ChangePlan {
    operation: format!("install_public_skill:{}:{}", safe_slug, mode_label),
    files,
    warnings,
    validate_config: false,
    create_dirs: Vec::new(),
    remove_dirs_before,
    remove_dirs: Vec::new(),
  })
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

fn read_text_or_binary(path: &Path) -> AppResult<(Option<String>, bool)> {
  let bytes = std_fs::read(path)?;
  match String::from_utf8(bytes) {
    Ok(text) => Ok((Some(text), false)),
    Err(_) => Ok((Some(String::new()), true)),
  }
}

fn read_text_or_binary_bytes(
  path: &Path,
) -> AppResult<(Option<String>, Option<Vec<u8>>, bool)> {
  let bytes = std_fs::read(path)?;
  match String::from_utf8(bytes.clone()) {
    Ok(text) => Ok((Some(text), None, false)),
    Err(_) => Ok((Some(String::new()), Some(bytes), true)),
  }
}

fn build_change_from_bytes(
  path: PathBuf,
  bytes: Vec<u8>,
  before: Option<String>,
  before_binary: bool,
) -> FileChange {
  match String::from_utf8(bytes.clone()) {
    Ok(text) => FileChange {
      path,
      before,
      after: Some(text),
      after_bytes: None,
      redact: false,
      binary: before_binary,
    },
    Err(_) => FileChange {
      path,
      before,
      after: Some(String::new()),
      after_bytes: Some(bytes),
      redact: false,
      binary: true,
    },
  }
}

fn collect_skill_files(dir: &Path) -> AppResult<Vec<PathBuf>> {
  if !dir.exists() {
    return Err(AppError::new("skill_missing", "Skill directory not found"));
  }
  let mut files = Vec::new();
  for entry in WalkDir::new(dir)
    .min_depth(1)
    .into_iter()
    .filter_map(Result::ok)
  {
    if entry.file_type().is_file() {
      files.push(entry.path().to_path_buf());
    }
  }
  files.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
  Ok(files)
}

fn validate_skill_file_name(name: &str) -> AppResult<String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err(AppError::new("file_name", "File name cannot be empty"));
  }
  if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") || trimmed.contains(':')
  {
    return Err(AppError::new("file_name", "File name must not include paths"));
  }
  Ok(trimmed.to_string())
}

fn append_folder_plan(
  skill_dir: &Path,
  folder: &str,
  spec: &SkillFolderSpec,
  files: &mut Vec<FileChange>,
  create_dirs: &mut Vec<PathBuf>,
  warnings: &mut Vec<String>,
) -> AppResult<()> {
  if !spec.enabled {
    return Ok(());
  }
  let folder_dir = skill_dir.join(folder);
  if !folder_dir.exists() {
    create_dirs.push(folder_dir.clone());
    warnings.push(format!("Will create folder: {}/", folder));
  }
  let mut created_files = Vec::new();
  let mut skipped_files = Vec::new();
  for file_name in &spec.files {
    let safe_name = validate_skill_file_name(file_name)?;
    let file_path = folder_dir.join(&safe_name);
    if files.iter().any(|change| change.path == file_path) {
      continue;
    }
    if file_path.exists() {
      skipped_files.push(format!("{}/{}", folder, safe_name));
      continue;
    }
    files.push(FileChange {
      path: file_path,
      before: None,
      after: Some(String::new()),
      after_bytes: None,
      redact: false,
      binary: false,
    });
    created_files.push(format!("{}/{}", folder, safe_name));
  }
  if !created_files.is_empty() {
    warnings.push(format!(
      "Will create files: {}",
      created_files.join(", ")
    ));
  }
  if !skipped_files.is_empty() {
    warnings.push(format!(
      "Skipped existing files: {}",
      skipped_files.join(", ")
    ));
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::io::Write;
  use zip::write::FileOptions;

  fn build_test_zip() -> Vec<u8> {
    let mut buffer = Vec::new();
    {
      let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
      let options = FileOptions::default();
      zip
        .start_file("demo-skill/SKILL.md", options)
        .expect("skill md");
      zip.write_all(b"# Demo\n").expect("write skill");
      zip
        .start_file("demo-skill/assets/logo.png", options)
        .expect("asset");
      zip.write_all(&[137, 80, 78, 71]).expect("write asset");
      zip
        .start_file("demo-skill/scripts/run.ts", options)
        .expect("script");
      zip.write_all(b"console.log('hi');").expect("write script");
      zip.finish().expect("finish zip");
    }
    buffer
  }

  fn setup_existing_skill(codex_home: &Path) -> PathBuf {
    let skill_dir = user_skills_root(codex_home).join("demo-skill");
    fs::create_dir_all(skill_dir.join("assets")).expect("assets dir");
    fs::create_dir_all(skill_dir.join("scripts")).expect("scripts dir");
    fs::write(skill_dir.join("SKILL.md"), "# Old\n").expect("skill md");
    fs::write(skill_dir.join("extra.txt"), "extra").expect("extra");
    skill_dir
  }

  fn build_settings(codex_home: &Path) -> Settings {
    Settings {
      codex_home: codex_home.to_string_lossy().to_string(),
      repo_roots: Vec::new(),
      cli_path: None,
    }
  }

  #[test]
  fn install_remote_skill_overlay_keeps_extras() {
    let temp = tempfile::tempdir().expect("tempdir");
    let codex_home = temp.path().join("codex");
    let skill_dir = setup_existing_skill(&codex_home);
    let settings = build_settings(&codex_home);
    let plan = build_install_remote_skill_plan(
      &settings,
      &codex_home,
      "demo-skill",
      SkillScope::User,
      None,
      InstallMode::Overlay,
      build_test_zip(),
    )
    .expect("plan");
    let extra_path = skill_dir.join("extra.txt");
    assert!(plan.remove_dirs_before.is_empty());
    assert!(plan.remove_dirs.is_empty());
    assert!(!plan.files.iter().any(|change| change.path == extra_path));
  }

  #[test]
  fn install_remote_skill_replace_removes_existing() {
    let temp = tempfile::tempdir().expect("tempdir");
    let codex_home = temp.path().join("codex");
    let skill_dir = setup_existing_skill(&codex_home);
    let settings = build_settings(&codex_home);
    let plan = build_install_remote_skill_plan(
      &settings,
      &codex_home,
      "demo-skill",
      SkillScope::User,
      None,
      InstallMode::Replace,
      build_test_zip(),
    )
    .expect("plan");
    let extra_path = skill_dir.join("extra.txt");
    assert!(plan.remove_dirs_before.contains(&skill_dir));
    assert!(plan.files.iter().any(|change| {
      change.path == extra_path && change.after.is_none()
    }));
  }

  #[test]
  fn install_remote_skill_sync_deletes_extras() {
    let temp = tempfile::tempdir().expect("tempdir");
    let codex_home = temp.path().join("codex");
    let skill_dir = setup_existing_skill(&codex_home);
    let settings = build_settings(&codex_home);
    let plan = build_install_remote_skill_plan(
      &settings,
      &codex_home,
      "demo-skill",
      SkillScope::User,
      None,
      InstallMode::Sync,
      build_test_zip(),
    )
    .expect("plan");
    let extra_path = skill_dir.join("extra.txt");
    assert!(plan.remove_dirs_before.is_empty());
    assert!(plan.files.iter().any(|change| {
      change.path == extra_path && change.after.is_none()
    }));
  }
}

fn build_plan_diff(plan: &ChangePlan) -> AppResult<String> {
  let mut output = String::new();
  for file in &plan.files {
    let before = file.before.as_deref().unwrap_or("");
    let after = file.after.as_deref().unwrap_or("");
    let (before_text, after_text) = if file.binary {
      let before_label = if file.before.is_some() {
        "[binary file before]".to_string()
      } else {
        "".to_string()
      };
      let after_label = if file.after.is_some() {
        "[binary file after]".to_string()
      } else {
        "".to_string()
      };
      (before_label, after_label)
    } else if file.redact {
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
  for dir in &plan.remove_dirs_before {
    if dir.exists() {
      std_fs::remove_dir_all(dir)?;
    }
  }
  for dir in &plan.create_dirs {
    std_fs::create_dir_all(dir)?;
  }
  for file in &plan.files {
    match (&file.after, &file.after_bytes) {
      (_, Some(bytes)) => {
        fs::write_atomic_bytes(&file.path, bytes)?;
      }
      (Some(content), None) => {
        fs::write_atomic(&file.path, content)?;
      }
      (None, None) => {
        if file.path.exists() {
          std_fs::remove_file(&file.path)?;
        }
      }
    }
  }
  for dir in &plan.remove_dirs {
    if dir.exists() {
      std_fs::remove_dir_all(dir)?;
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

fn cleanup_created_dirs(dirs: &[PathBuf]) {
  for dir in dirs.iter().rev() {
    if dir.exists() {
      let _ = std_fs::remove_dir(dir);
    }
  }
}

fn user_config_path(paths: &AppPaths, name: &str) -> AppResult<PathBuf> {
  let slug = sanitize_config_name(name)?;
  Ok(paths.user_configs_dir().join(format!("{}.toml", slug)))
}

fn should_redact_toml(_path: &Path, _user_configs_dir: &Path) -> bool {
  false
}

fn parse_toml_json(text: &str) -> (Option<serde_json::Value>, Option<String>) {
  match text.parse::<toml::Value>() {
    Ok(value) => match serde_json::to_value(value) {
      Ok(json) => (Some(json), None),
      Err(error) => (None, Some(error.to_string())),
    },
    Err(error) => (None, Some(error.to_string())),
  }
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
      after_bytes: None,
      redact,
      binary: false,
    }],
    warnings: Vec::new(),
    validate_config,
    create_dirs: Vec::new(),
    remove_dirs_before: Vec::new(),
    remove_dirs: Vec::new(),
  }
}

