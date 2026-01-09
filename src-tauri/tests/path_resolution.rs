use std::path::PathBuf;

use codex_manager::paths::is_within_root;

#[test]
fn path_resolution_blocks_escape() {
  let root = PathBuf::from("C:/work/root");
  let child = root.join("skills/alpha/SKILL.md");
  let outside = PathBuf::from("C:/work/other/SKILL.md");
  assert!(is_within_root(&root, &child));
  assert!(!is_within_root(&root, &outside));
}