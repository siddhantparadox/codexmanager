use codex_manager::models::{CodexRunOptions, WorkspaceEntry, WorkspaceRegistry};
use codex_manager::workspace_registry::{load_registry, remove_entry, save_registry, upsert_entry};

#[test]
fn registry_round_trip_and_upsert() {
  let temp = tempfile::tempdir().expect("tempdir");
  let path = temp.path().join("workspaces.json");

  let mut registry = WorkspaceRegistry::default();
  upsert_entry(
    &mut registry,
    WorkspaceEntry {
      id: "".to_string(),
      name: Some("Repo".to_string()),
      path: "C:/repo".to_string(),
      default_profile: Some("work".to_string()),
      last_run: Some(CodexRunOptions {
        model: Some("gpt-5-codex".to_string()),
        sandbox: Some("workspace-write".to_string()),
        ..Default::default()
      }),
    },
  );
  assert_eq!(registry.items.len(), 1);
  assert_eq!(registry.items[0].id, "C:/repo");

  save_registry(&path, &registry).expect("save");
  let loaded = load_registry(&path).expect("load");
  assert_eq!(loaded.items.len(), 1);
  let entry = &loaded.items[0];
  assert_eq!(entry.name.as_deref(), Some("Repo"));
  assert_eq!(entry.default_profile.as_deref(), Some("work"));
  assert_eq!(
    entry.last_run.as_ref().and_then(|run| run.model.as_deref()),
    Some("gpt-5-codex")
  );

  let mut registry = loaded;
  remove_entry(&mut registry, "C:/repo");
  assert!(registry.items.is_empty());
}
