use std::fs;

use codex_manager::fs::{create_backup, restore_backup};

#[test]
fn backup_and_restore_binary_round_trip() {
  let temp = tempfile::tempdir().expect("tempdir");
  let file_path = temp.path().join("asset.bin");
  let original = vec![0, 159, 146, 150, 255, 0, 1, 2];
  fs::write(&file_path, &original).expect("write original");

  let backup_root = temp.path().join("backups");
  let backup = create_backup(&backup_root, "binary-test", &[file_path.clone()])
    .expect("backup");

  fs::write(&file_path, vec![1, 2, 3]).expect("write modified");
  restore_backup(&backup_root, &backup.id).expect("restore");

  let restored = fs::read(&file_path).expect("read restored");
  assert_eq!(restored, original);
}
