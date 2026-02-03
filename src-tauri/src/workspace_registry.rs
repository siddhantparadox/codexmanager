use std::path::Path;

use crate::errors::{AppError, AppResult};
use crate::fs::write_atomic;
use crate::models::{WorkspaceEntry, WorkspaceRegistry};

pub fn load_registry(path: &Path) -> AppResult<WorkspaceRegistry> {
  if !path.exists() {
    return Ok(WorkspaceRegistry {
      version: 1,
      items: Vec::new(),
    });
  }
  let content = std::fs::read_to_string(path)?;
  let registry: WorkspaceRegistry =
    serde_json::from_str(&content).map_err(|error| {
      AppError::new("workspace_registry", format!("Invalid registry JSON: {}", error))
    })?;
  Ok(registry)
}

pub fn save_registry(path: &Path, registry: &WorkspaceRegistry) -> AppResult<()> {
  let payload = serde_json::to_string_pretty(registry)?;
  write_atomic(path, &payload)?;
  Ok(())
}

pub fn upsert_entry(registry: &mut WorkspaceRegistry, mut entry: WorkspaceEntry) {
  if entry.id.trim().is_empty() {
    entry.id = entry.path.clone();
  }
  if let Some(existing) = registry.items.iter_mut().find(|item| item.id == entry.id) {
    *existing = entry;
  } else {
    registry.items.push(entry);
  }
}

pub fn remove_entry(registry: &mut WorkspaceRegistry, id: &str) {
  registry.items.retain(|item| item.id != id);
}
