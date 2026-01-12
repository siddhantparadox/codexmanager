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
  pub description: Option<String>,
  pub dir: String,
  pub path: String,
  pub scope: SkillScope,
  pub repo_root: Option<String>,
  pub modified: Option<String>,
  pub counts: SkillFileCounts,
  pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SkillFileCounts {
  pub skill_md: usize,
  pub references: usize,
  pub scripts: usize,
  pub assets: usize,
  pub other: usize,
}

#[derive(Debug, Serialize)]
pub struct SkillFileEntry {
  pub path: String,
  pub relative_path: String,
  pub kind: String,
  pub size: Option<u64>,
  pub category: String,
}

#[derive(Debug, Serialize)]
pub struct RemoteSkillDetail {
  pub slug: String,
  pub name: String,
  pub description: Option<String>,
  pub tags: Vec<String>,
  pub updated_at: Option<String>,
  pub skill_md: Option<String>,
  pub files: Vec<String>,
  pub download_url: Option<String>,
  pub source_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RemoteSkillSummary {
  pub slug: String,
  pub name: String,
  pub description: Option<String>,
  pub tags: Vec<String>,
  pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RemoteSkillPage {
  pub items: Vec<RemoteSkillSummary>,
  pub next_cursor: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillFolderSpec {
  pub enabled: bool,
  pub files: Vec<String>,
}

impl Default for SkillFolderSpec {
  fn default() -> Self {
    Self {
      enabled: true,
      files: Vec::new(),
    }
  }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillFolderConfig {
  pub scripts: SkillFolderSpec,
  pub references: SkillFolderSpec,
  pub assets: SkillFolderSpec,
}

impl Default for SkillFolderConfig {
  fn default() -> Self {
    Self {
      scripts: SkillFolderSpec::default(),
      references: SkillFolderSpec::default(),
      assets: SkillFolderSpec::default(),
    }
  }
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
    #[serde(default)]
    folders: SkillFolderConfig,
  },
  UpdateSkill { path: String, content: String },
  DeleteSkill { path: String },
  DeleteSkillFolder { dir: String },
  InstallRemoteSkill {
    slug: String,
    scope: SkillScope,
    repo_root: Option<String>,
    mode: InstallMode,
  },
  SaveUserConfig { name: String, content: String },
  DeleteUserConfig { name: String },
  RestoreBackup { backup_id: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum InstallMode {
  Overlay,
  Replace,
  Sync,
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
