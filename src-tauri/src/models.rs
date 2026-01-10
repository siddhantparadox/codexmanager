use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
  pub codex_home: String,
  pub repo_roots: Vec<String>,
  pub cli_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScanState {
  pub settings: Settings,
  pub config: ConfigSummary,
  pub skills: Vec<SkillSummary>,
  pub diagnostics: Vec<Diagnostic>,
  pub backups: Vec<BackupSummary>,
}

#[derive(Debug, Serialize)]
pub struct ConfigSummary {
  pub path: String,
  pub exists: bool,
  pub parse_error: Option<String>,
  pub scalars: Vec<ConfigScalar>,
  pub mcp_servers: Vec<McpServerSummary>,
}

#[derive(Debug, Serialize)]
pub struct ConfigScalar {
  pub key: String,
  pub kind: String,
  pub value: String,
}

#[derive(Debug, Serialize)]
pub struct McpServerSummary {
  pub name: String,
  pub enabled: bool,
  pub transport: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SkillSummary {
  pub id: String,
  pub name: String,
  pub path: String,
  pub scope: SkillScope,
  pub repo_root: Option<String>,
  pub modified: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserConfigSummary {
  pub id: String,
  pub name: String,
  pub modified: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Diagnostic {
  pub level: String,
  pub message: String,
  pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreviewResult {
  pub operation: String,
  pub diff: String,
  pub warnings: Vec<String>,
  pub files: Vec<PreviewFile>,
}

#[derive(Debug, Serialize)]
pub struct PreviewFile {
  pub path: String,
  pub exists: bool,
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
  pub backup_id: Option<String>,
  pub operation: String,
}

#[derive(Debug, Serialize)]
pub struct ConfigText {
  pub text: String,
  pub redacted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChangeRequest {
  ToggleMcpServer { name: String, enabled: bool },
  SetConfigScalar { key: String, value: ScalarValue },
  ReplaceConfig { content: String },
  UpsertMcpServer { name: String, table_toml: String },
  DeleteMcpServer { name: String },
  CreateSkill {
    scope: SkillScope,
    repo_root: Option<String>,
    name: String,
    content: String,
  },
  UpdateSkill { path: String, content: String },
  DeleteSkill { path: String },
  SaveUserConfig { name: String, content: String },
  DeleteUserConfig { name: String },
  RestoreBackup { backup_id: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum SkillScope {
  User,
  Repo,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ScalarValue {
  String(String),
  Integer(i64),
  Float(f64),
  Boolean(bool),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupManifest {
  pub id: String,
  pub created_at: String,
  pub operation: String,
  pub files: Vec<BackupFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupFile {
  pub path: String,
  pub backup_path: Option<String>,
  pub exists: bool,
  pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BackupSummary {
  pub id: String,
  pub created_at: String,
  pub operation: String,
  pub files: usize,
}
