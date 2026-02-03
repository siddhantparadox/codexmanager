use std::path::{Path, PathBuf};
use std::{env, fs};

use crate::errors::{AppError, AppResult};
use crate::models::Settings;
use tauri::AppHandle;
use tauri::Manager;

pub struct AppPaths {
  pub app_data_dir: PathBuf,
}

impl AppPaths {
  pub fn from_app(app: &AppHandle) -> AppResult<Self> {
    let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|error| AppError::new("path_error", error.to_string()))?;
    fs::create_dir_all(&app_data_dir)?;
    Ok(Self { app_data_dir })
  }

  pub fn settings_path(&self) -> PathBuf {
    self.app_data_dir.join("settings.json")
  }

  pub fn backups_dir(&self) -> PathBuf {
    self.app_data_dir.join("backups")
  }

  pub fn user_configs_dir(&self) -> PathBuf {
    self.app_data_dir.join("user-configs")
  }

  pub fn chat_overlays_path(&self) -> PathBuf {
    self.app_data_dir.join("chat-overlays.json")
  }

  pub fn workspaces_path(&self) -> PathBuf {
    self.app_data_dir.join("workspaces.json")
  }
}

pub fn default_codex_home() -> AppResult<PathBuf> {
  if let Ok(value) = env::var("CODEX_HOME") {
    return Ok(PathBuf::from(value));
  }
  let home = dirs::home_dir().ok_or_else(|| {
    AppError::new("path_error", "Unable to resolve home directory")
  })?;
  Ok(home.join(".codex"))
}

pub fn resolve_codex_home(settings: &Settings) -> AppResult<PathBuf> {
  if settings.codex_home.trim().is_empty() {
    return default_codex_home();
  }
  Ok(PathBuf::from(settings.codex_home.trim()))
}

pub fn config_path(codex_home: &Path) -> PathBuf {
  codex_home.join("config.toml")
}

pub fn workspace_config_path(workspace_root: &Path) -> PathBuf {
  workspace_root.join(".codex").join("config.toml")
}

pub fn user_skills_root(codex_home: &Path) -> PathBuf {
  codex_home.join("skills")
}

pub fn repo_skills_root(repo_root: &Path) -> PathBuf {
  repo_root.join(".codex").join("skills")
}

pub fn is_within_root(root: &Path, path: &Path) -> bool {
  let root_norm = normalize_path(root);
  let path_norm = normalize_path(path);
  path_norm.starts_with(root_norm)
}

pub fn sanitize_skill_name(name: &str) -> AppResult<String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err(AppError::new("invalid_name", "Skill name cannot be empty"));
  }
  let cleaned: String = trimmed
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
        ch
      } else {
        '-'
      }
    })
    .collect();
  Ok(cleaned)
}

pub fn sanitize_config_name(name: &str) -> AppResult<String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err(AppError::new("invalid_name", "Config name cannot be empty"));
  }
  let cleaned: String = trimmed
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
        ch
      } else {
        '-'
      }
    })
    .collect();
  Ok(cleaned)
}

fn normalize_path(path: &Path) -> PathBuf {
  let mut result = PathBuf::new();
  for component in path.components() {
    match component {
      std::path::Component::ParentDir => {
        result.pop();
      }
      std::path::Component::CurDir => {}
      other => result.push(other.as_os_str()),
    }
  }
  result
}
