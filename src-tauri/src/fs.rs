use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use walkdir::WalkDir;

use crate::errors::{AppError, AppResult};
use crate::models::{
  BackupFile, BackupManifest, BackupSummary, ConfigScalar, ConfigSummary,
  McpServerSummary, SkillSummary, SkillScope, UserConfigSummary,
};

pub fn read_text_file(path: &Path) -> AppResult<String> {
  Ok(fs::read_to_string(path)?)
}

pub fn write_atomic(path: &Path, content: &str) -> AppResult<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let stamp = OffsetDateTime::now_utc().unix_timestamp_nanos();
  let file_name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("file");
  let tmp_path = path.with_file_name(format!(".{}.tmp-{}", file_name, stamp));

  let mut file = File::create(&tmp_path)?;
  file.write_all(content.as_bytes())?;
  file.sync_all()?;

  if path.exists() {
    fs::remove_file(path)?;
  }

  fs::rename(&tmp_path, path)?;
  if let Some(parent) = path.parent() {
    let _ = File::open(parent).and_then(|dir| dir.sync_all());
  }
  Ok(())
}

pub fn create_backup(backup_root: &Path, operation: &str, files: &[PathBuf]) -> AppResult<BackupManifest> {
  fs::create_dir_all(backup_root)?;
  let (id, created_at) = build_backup_id(operation)?;
  let backup_dir = backup_root.join(&id);
  fs::create_dir_all(&backup_dir)?;

  let mut entries = Vec::new();
  for (index, path) in files.iter().enumerate() {
    let path_string = path.to_string_lossy().to_string();
    if path.exists() {
      let bytes = fs::read(path)?;
      let sha256 = Some(hash_bytes(&bytes));
      let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
      let backup_file_name = format!("{:02}_{}", index, file_name);
      let backup_path = backup_dir.join(backup_file_name);
      fs::write(&backup_path, &bytes)?;
      entries.push(BackupFile {
        path: path_string,
        backup_path: Some(backup_path.to_string_lossy().to_string()),
        exists: true,
        sha256,
      });
    } else {
      entries.push(BackupFile {
        path: path_string,
        backup_path: None,
        exists: false,
        sha256: None,
      });
    }
  }

  let manifest = BackupManifest {
    id: id.clone(),
    created_at,
    operation: operation.to_string(),
    files: entries,
  };
  let manifest_path = backup_dir.join("manifest.json");
  let manifest_json = serde_json::to_string_pretty(&manifest)?;
  write_atomic(&manifest_path, &manifest_json)?;
  Ok(manifest)
}

pub fn list_backups(backup_root: &Path) -> AppResult<Vec<BackupSummary>> {
  if !backup_root.exists() {
    return Ok(Vec::new());
  }
  let mut summaries = Vec::new();
  for entry in fs::read_dir(backup_root)? {
    let entry = entry?;
    if !entry.file_type()?.is_dir() {
      continue;
    }
    let manifest_path = entry.path().join("manifest.json");
    if !manifest_path.exists() {
      continue;
    }
    let text = fs::read_to_string(manifest_path)?;
    let manifest: BackupManifest = serde_json::from_str(&text)?;
    summaries.push(BackupSummary {
      id: manifest.id,
      created_at: manifest.created_at,
      operation: manifest.operation,
      files: manifest.files.len(),
    });
  }
  summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
  Ok(summaries)
}

pub fn load_backup_manifest(backup_root: &Path, id: &str) -> AppResult<BackupManifest> {
  let manifest_path = backup_root.join(id).join("manifest.json");
  if !manifest_path.exists() {
    return Err(AppError::new("backup_missing", "Backup not found"));
  }
  let text = fs::read_to_string(manifest_path)?;
  let manifest: BackupManifest = serde_json::from_str(&text)?;
  Ok(manifest)
}

pub fn restore_backup(backup_root: &Path, id: &str) -> AppResult<BackupManifest> {
  let manifest = load_backup_manifest(backup_root, id)?;
  for file in &manifest.files {
    let target = PathBuf::from(&file.path);
    match &file.backup_path {
      Some(backup_path) => {
        let content = fs::read_to_string(backup_path)?;
        write_atomic(&target, &content)?;
      }
      None => {
        if target.exists() {
          fs::remove_file(&target)?;
        }
      }
    }
  }
  Ok(manifest)
}

pub fn scan_config(config_path: &Path) -> ConfigSummary {
  let mut summary = ConfigSummary {
    path: config_path.to_string_lossy().to_string(),
    exists: config_path.exists(),
    parse_error: None,
    scalars: Vec::new(),
    mcp_servers: Vec::new(),
  };

  if !summary.exists {
    return summary;
  }

  let text = match fs::read_to_string(config_path) {
    Ok(text) => text,
    Err(error) => {
      summary.parse_error = Some(error.to_string());
      return summary;
    }
  };

  let value: toml::Value = match text.parse() {
    Ok(value) => value,
    Err(error) => {
      summary.parse_error = Some(error.to_string());
      return summary;
    }
  };

  let table = match value.as_table() {
    Some(table) => table,
    None => return summary,
  };

  for (key, value) in table.iter() {
    if is_sensitive_key(key) {
      continue;
    }
    match value {
      toml::Value::String(inner) => summary.scalars.push(ConfigScalar {
        key: key.clone(),
        kind: "string".to_string(),
        value: inner.clone(),
      }),
      toml::Value::Integer(inner) => summary.scalars.push(ConfigScalar {
        key: key.clone(),
        kind: "integer".to_string(),
        value: inner.to_string(),
      }),
      toml::Value::Float(inner) => summary.scalars.push(ConfigScalar {
        key: key.clone(),
        kind: "float".to_string(),
        value: inner.to_string(),
      }),
      toml::Value::Boolean(inner) => summary.scalars.push(ConfigScalar {
        key: key.clone(),
        kind: "boolean".to_string(),
        value: inner.to_string(),
      }),
      _ => {}
    }
  }

  if let Some(mcp_table) = table.get("mcp_servers").and_then(|value| value.as_table()) {
    for (name, server) in mcp_table.iter() {
      let enabled = server
        .get("enabled")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
      let transport = server
        .get("transport")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
          server
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
        });
      summary.mcp_servers.push(McpServerSummary {
        name: name.clone(),
        enabled,
        transport,
      });
    }
  }

  summary.mcp_servers.sort_by(|a, b| a.name.cmp(&b.name));
  summary.scalars.sort_by(|a, b| a.key.cmp(&b.key));
  summary
}

pub fn scan_skills(user_root: &Path, repo_roots: &[PathBuf]) -> Vec<SkillSummary> {
  let mut skills = Vec::new();
  if user_root.exists() {
    skills.extend(scan_skills_root(user_root, SkillScope::User, None));
  }
  for repo_root in repo_roots {
    let root = repo_root.join(".codex").join("skills");
    if root.exists() {
      skills.extend(scan_skills_root(&root, SkillScope::Repo, Some(repo_root)));
    }
  }
  skills.sort_by(|a, b| a.name.cmp(&b.name));
  skills
}

pub fn list_user_configs(root: &Path) -> AppResult<Vec<UserConfigSummary>> {
  if !root.exists() {
    return Ok(Vec::new());
  }
  let mut configs = Vec::new();
  for entry in fs::read_dir(root)? {
    let entry = entry?;
    if !entry.file_type()?.is_file() {
      continue;
    }
    let path = entry.path();
    let is_toml = path
      .extension()
      .and_then(|ext| ext.to_str())
      .map(|ext| ext.eq_ignore_ascii_case("toml"))
      .unwrap_or(false);
    if !is_toml {
      continue;
    }
    let id = path
      .file_stem()
      .and_then(|name| name.to_str())
      .unwrap_or("config")
      .to_string();
    let modified = entry
      .metadata()
      .ok()
      .and_then(|meta| meta.modified().ok())
      .and_then(|time| OffsetDateTime::from(time).format(&Rfc3339).ok());
    configs.push(UserConfigSummary {
      id: id.clone(),
      name: id,
      modified,
    });
  }
  configs.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(configs)
}

fn scan_skills_root(root: &Path, scope: SkillScope, repo_root: Option<&PathBuf>) -> Vec<SkillSummary> {
  let mut results = Vec::new();
  for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
    if !entry.file_type().is_file() {
      continue;
    }
    if entry.file_name().to_string_lossy().eq_ignore_ascii_case("SKILL.md") {
      let path = entry.path();
      let content = fs::read_to_string(path).unwrap_or_default();
      let fallback = path
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Skill".to_string());
      let name = parse_skill_name(&content, &fallback);
      let id = path.strip_prefix(root).unwrap_or(path).to_string_lossy().to_string();
      results.push(SkillSummary {
        id,
        name,
        path: path.to_string_lossy().to_string(),
        scope: scope.clone(),
        repo_root: repo_root.map(|root| root.to_string_lossy().to_string()),
        modified: None,
      });
    }
  }
  results
}

fn parse_skill_name(content: &str, fallback: &str) -> String {
  if !content.starts_with("---") {
    return fallback.to_string();
  }
  for line in content.lines().skip(1) {
    let trimmed = line.trim();
    if trimmed == "---" {
      break;
    }
    if let Some(rest) = trimmed.strip_prefix("name:") {
      let value = rest.trim();
      if !value.is_empty() {
        return value.to_string();
      }
    }
  }
  fallback.to_string()
}

fn build_backup_id(operation: &str) -> AppResult<(String, String)> {
  let now = OffsetDateTime::now_utc();
  let created_at = now.format(&Rfc3339).unwrap_or_else(|_| "".to_string());
  let format = time::format_description::parse("[year][month][day]_[hour][minute][second]")
    .map_err(|error| AppError::new("time_format", error.to_string()))?;
  let stamp = now
    .format(&format)
    .map_err(|error| AppError::new("time_format", error.to_string()))?;
  let clean_op: String = operation
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
    .collect();
  Ok((format!("{}_{}", stamp, clean_op), created_at))
}

fn hash_bytes(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hex::encode(hasher.finalize())
}

fn is_sensitive_key(key: &str) -> bool {
  let key = key.to_ascii_lowercase();
  key.contains("token")
    || key.contains("secret")
    || key.contains("api_key")
    || key.contains("apikey")
    || key.contains("password")
    || key.contains("bearer")
}
