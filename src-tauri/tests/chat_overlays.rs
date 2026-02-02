use codex_manager::chat_overlays::{load_overlays, save_overlays, ChatOverlay, ChatOverlayStore};

#[test]
fn overlays_round_trip() {
  let temp = tempfile::tempdir().expect("tempdir");
  let path = temp.path().join("chat-overlays.json");

  let mut store = ChatOverlayStore::default();
  store.version = 1;
  store.items.insert(
    "session-1".to_string(),
    ChatOverlay {
      pinned: true,
      archived: false,
      last_read_ts: Some(123),
      title: Some("Renamed session".to_string()),
      draft: Some("Draft text".to_string()),
    },
  );
  save_overlays(&path, &store).expect("save overlays");

  let loaded = load_overlays(&path).expect("load overlays");
  let overlay = loaded.items.get("session-1").expect("overlay");
  assert!(overlay.pinned);
  assert!(!overlay.archived);
  assert_eq!(overlay.last_read_ts, Some(123));
  assert_eq!(overlay.title.as_deref(), Some("Renamed session"));
  assert_eq!(overlay.draft.as_deref(), Some("Draft text"));
}
