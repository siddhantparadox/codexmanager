use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::fs::write_atomic;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ChatOverlay {
  pub pinned: bool,
  pub archived: bool,
  pub last_read_ts: Option<i64>,
  pub title: Option<String>,
  pub draft: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ChatOverlayStore {
  pub version: u32,
  pub items: HashMap<String, ChatOverlay>,
}

pub fn load_overlays(path: &Path) -> AppResult<ChatOverlayStore> {
  if !path.exists() {
    return Ok(ChatOverlayStore {
      version: 1,
      items: HashMap::new(),
    });
  }
  let content = std::fs::read_to_string(path)?;
  let store: ChatOverlayStore = serde_json::from_str(&content).map_err(|error| {
    AppError::new("chat_overlays", format!("Invalid overlay JSON: {}", error))
  })?;
  Ok(store)
}

pub fn save_overlays(path: &Path, store: &ChatOverlayStore) -> AppResult<()> {
  let payload = serde_json::to_string_pretty(store)?;
  write_atomic(path, &payload)?;
  Ok(())
}
