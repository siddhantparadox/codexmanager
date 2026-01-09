use crate::errors::AppResult;
use crate::models::Settings;
use crate::paths::{default_codex_home, AppPaths};
use crate::fs::write_atomic;
use tauri::AppHandle;

#[derive(Debug)]
pub struct AppState {
  pub settings: Settings,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      settings: Settings {
        codex_home: String::new(),
        repo_roots: Vec::new(),
        cli_path: None,
      },
    }
  }
}

pub fn load_settings(app: &AppHandle) -> AppResult<Settings> {
  let paths = AppPaths::from_app(app)?;
  let settings_path = paths.settings_path();
  if settings_path.exists() {
    let data = std::fs::read_to_string(settings_path)?;
    let settings: Settings = serde_json::from_str(&data)?;
    return Ok(settings);
  }

  let default_home = default_codex_home()?;
  let settings = Settings {
    codex_home: default_home.to_string_lossy().to_string(),
    repo_roots: Vec::new(),
    cli_path: None,
  };
  save_settings(app, &settings)?;
  Ok(settings)
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> AppResult<()> {
  let paths = AppPaths::from_app(app)?;
  let json = serde_json::to_string_pretty(settings)?;
  write_atomic(&paths.settings_path(), &json)?;
  Ok(())
}

pub fn normalize_settings(mut settings: Settings) -> Settings {
  settings.codex_home = settings.codex_home.trim().to_string();
  settings.repo_roots = settings
    .repo_roots
    .iter()
    .map(|root| root.trim().to_string())
    .filter(|root| !root.is_empty())
    .collect();
  settings.repo_roots.sort();
  settings.repo_roots.dedup();
  settings
}
