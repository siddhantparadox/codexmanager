pub mod commands;
pub mod codex_commands;
pub mod chat_sessions;
pub mod chat_overlays;
pub mod codex_usage;
pub mod codex_usage_local;
pub mod errors;
pub mod fs;
pub mod models;
pub mod paths;
pub mod skills_registry;
pub mod state;
pub mod toml_patch;
pub mod workspace_registry;

use std::sync::Mutex;

pub fn run() {
  tauri::Builder::default()
    .manage(Mutex::new(state::AppState::default()))
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      commands::get_settings,
      commands::update_settings,
      commands::scan_state,
      commands::chat_sessions_list,
      commands::chat_overlay_set,
      commands::chat_session_latest,
      commands::chat_session_page,
      commands::read_config_text,
      commands::read_skill_text,
      commands::list_skill_files,
      commands::fetch_public_skill,
      commands::list_public_skills,
      commands::list_user_configs,
      commands::read_user_config_text,
      commands::export_wrapped_png,
      commands::preview_change,
      commands::apply_change,
      commands::list_backups,
      commands::delete_backup,
      commands::delete_all_backups,
      commands::codex_build_command,
      commands::codex_run_command,
      commands::workspaces_list,
      commands::workspaces_upsert,
      commands::workspaces_remove,
      codex_usage::codex_get_usage_snapshot,
      codex_usage_local::codex_get_local_usage_summary
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
