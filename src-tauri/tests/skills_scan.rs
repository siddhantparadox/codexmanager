use std::collections::HashMap;
use std::fs;

use codex_manager::fs::{list_skill_files, scan_skills};

#[test]
fn scan_skills_counts_and_categories() {
  let temp = tempfile::tempdir().expect("tempdir");
  let user_root = temp.path().join("skills");
  let skill_dir = user_root.join("test-skill");
  fs::create_dir_all(skill_dir.join("scripts")).expect("scripts dir");
  fs::create_dir_all(skill_dir.join("script")).expect("script alias dir");
  fs::create_dir_all(skill_dir.join("references")).expect("references dir");
  fs::create_dir_all(skill_dir.join("reference")).expect("reference alias dir");
  fs::create_dir_all(skill_dir.join("assets")).expect("assets dir");
  fs::create_dir_all(skill_dir.join("asset")).expect("asset alias dir");
  fs::create_dir_all(skill_dir.join("misc")).expect("misc dir");

  fs::write(
    skill_dir.join("SKILL.md"),
    "---\nname: test-skill\ndescription: Example\n---\n# Skill\n",
  )
  .expect("skill md");
  fs::write(skill_dir.join("scripts/run.ts"), "console.log('hi');").expect("run");
  fs::write(skill_dir.join("script/legacy.sh"), "echo legacy").expect("legacy");
  fs::write(
    skill_dir.join("references/notes.md"),
    "# Notes",
  )
  .expect("notes");
  fs::write(skill_dir.join("reference/extra.md"), "# Extra").expect("extra");
  fs::write(skill_dir.join("assets/logo.png"), [137, 80, 78, 71]).expect("logo");
  fs::write(skill_dir.join("asset/template.txt"), "tmpl").expect("tmpl");
  fs::write(skill_dir.join("misc/other.txt"), "other").expect("other");

  let skills = scan_skills(&user_root, &[]);
  assert_eq!(skills.len(), 1);
  let skill = &skills[0];
  assert_eq!(skill.name, "test-skill");
  assert!(skill.warnings.is_empty());
  assert_eq!(skill.counts.skill_md, 1);
  assert_eq!(skill.counts.scripts, 2);
  assert_eq!(skill.counts.references, 2);
  assert_eq!(skill.counts.assets, 2);
  assert_eq!(skill.counts.other, 1);

  let files = list_skill_files(&skill_dir).expect("list files");
  let mut categories = HashMap::new();
  for file in files {
    categories.insert(file.relative_path, file.category);
  }
  assert_eq!(
    categories.get("scripts/run.ts").map(String::as_str),
    Some("scripts")
  );
  assert_eq!(
    categories.get("script/legacy.sh").map(String::as_str),
    Some("scripts")
  );
  assert_eq!(
    categories.get("references/notes.md").map(String::as_str),
    Some("references")
  );
  assert_eq!(
    categories.get("reference/extra.md").map(String::as_str),
    Some("references")
  );
  assert_eq!(
    categories.get("assets/logo.png").map(String::as_str),
    Some("assets")
  );
  assert_eq!(
    categories.get("asset/template.txt").map(String::as_str),
    Some("assets")
  );
  assert_eq!(
    categories.get("misc/other.txt").map(String::as_str),
    Some("other")
  );
}
