use codex_manager::skills_registry::list_zip_paths;
use std::io::Write;
use zip::write::FileOptions;

#[test]
fn zip_path_listing_strips_root_and_skips_mac_files() {
  let mut buffer = Vec::new();
  {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
    let options = FileOptions::default();
    zip.start_file("skill-a/SKILL.md", options).expect("skill md");
    zip.write_all(b"# Skill").expect("write skill");
    zip.start_file("skill-a/assets/logo.png", options)
      .expect("asset");
    zip.write_all(&[137, 80, 78, 71]).expect("write asset");
    zip.start_file("__MACOSX/._SKILL.md", options)
      .expect("macos file");
    zip.write_all(b"ignored").expect("write ignored");
    zip.finish().expect("finish zip");
  }

  let paths = list_zip_paths(&buffer).expect("list paths");
  assert!(paths.contains(&"SKILL.md".to_string()));
  assert!(paths.contains(&"assets/logo.png".to_string()));
  assert!(!paths.iter().any(|path| path.contains("__MACOSX")));
}
