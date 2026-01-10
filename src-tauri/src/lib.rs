pub mod commands;
pub mod errors;
pub mod fs;
pub mod models;
pub mod paths;
pub mod state;
pub mod toml_patch;

use std::sync::Mutex;

pub fn run() {
  tauri::Builder::default()
    .manage(Mutex::new(state::AppState::default()))
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      commands::get_settings,
      commands::update_settings,
      commands::scan_state,
      commands::read_config_text,
      commands::read_skill_text,
      commands::list_user_configs,
      commands::read_user_config_text,
      commands::preview_change,
      commands::apply_change,
      commands::list_backups
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
