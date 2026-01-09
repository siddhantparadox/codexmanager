use std::fs;

use codex_manager::fs::{create_backup, restore_backup};

#[test]
fn backup_and_restore_round_trip() {
  let temp = tempfile::tempdir().expect("tempdir");
  let file_path = temp.path().join("config.toml");
  fs::write(&file_path, "alpha").expect("write");

  let backup_root = temp.path().join("backups");
  let backup = create_backup(&backup_root, "test", &[file_path.clone()])
    .expect("backup");

  fs::write(&file_path, "beta").expect("write");
  restore_backup(&backup_root, &backup.id).expect("restore");

  let restored = fs::read_to_string(&file_path).expect("read");
  assert_eq!(restored, "alpha");
}