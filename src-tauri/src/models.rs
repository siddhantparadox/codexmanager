use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

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
pub struct ChatSessionSummary {
  pub id: String,
  pub first_ts: Option<i64>,
  pub last_ts: Option<i64>,
  pub message_count: u64,
  pub last_model: Option<String>,
  pub last_cwd: Option<String>,
  pub title: Option<String>,
  pub draft: Option<String>,
  pub pinned: bool,
  pub archived: bool,
  pub last_read_ts: Option<i64>,
  pub has_unread: bool,
}

#[derive(Debug, Serialize)]
pub struct ChatSessionsResponse {
  pub sessions_path: String,
  pub sessions_dir_exists: bool,
  pub sessions: Vec<ChatSessionSummary>,
  pub files_seen: usize,
  pub files_parsed: usize,
  pub parse_errors: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct ChatMessage {
  pub id: String,
  pub role: String,
  pub content: String,
  pub timestamp: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_call_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_status: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub kind: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub subtype: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub raw_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChatMessagesPage {
  pub session_id: String,
  pub total_count: usize,
  pub next_cursor: Option<usize>,
  pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CodexRunOptions {
  pub cwd: Option<String>,
  pub profile: Option<String>,
  pub model: Option<String>,
  pub sandbox: Option<String>,
  pub approvals: Option<String>,
  pub search: Option<bool>,
  pub prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexCommandRequest {
  pub kind: String,
  pub session_id: Option<String>,
  pub options: CodexRunOptions,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexCommandPreview {
  pub executable: String,
  pub args: Vec<String>,
  pub display: String,
  pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexCommandResult {
  pub preview: CodexCommandPreview,
  pub stdout: String,
  pub stderr: String,
  pub exit_code: Option<i32>,
  pub timed_out: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceEntry {
  pub id: String,
  pub name: Option<String>,
  pub path: String,
  pub default_profile: Option<String>,
  pub last_run: Option<CodexRunOptions>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct WorkspaceRegistry {
  pub version: u32,
  pub items: Vec<WorkspaceEntry>,
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
  pub parsed: Option<JsonValue>,
  pub parse_error: Option<String>,
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
  SetConfigPath { path: Vec<String>, value: ScalarValue },
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

#[derive(Debug, Serialize)]
pub struct UsageWindowView {
  pub used_percent: f64,
  pub remaining_percent: f64,
  pub window_seconds: Option<u64>,
  pub resets_in_seconds: Option<u64>,
  pub resets_in_human: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CodexUsageSnapshot {
  pub plan_type: Option<String>,
  pub primary: Option<UsageWindowView>,
  pub secondary: Option<UsageWindowView>,
  pub code_review: Option<UsageWindowView>,
  pub limit_reached: Option<bool>,
  pub extras: Vec<(String, String)>,
  pub auth_path: String,
  pub auth_status: String,
  pub login_method: String,
  pub token_source: String,
  pub last_refresh: Option<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct UsageTotals {
  pub input_tokens: u64,
  pub cached_input_tokens: u64,
  pub output_tokens: u64,
  pub reasoning_output_tokens: u64,
  pub total_tokens: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct UsageDailyPoint {
  pub date: String,
  pub total_tokens: u64,
  pub input_tokens: u64,
  pub cached_input_tokens: u64,
  pub output_tokens: u64,
  pub reasoning_output_tokens: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct UsageBreakdown {
  pub key: String,
  pub totals: UsageTotals,
}

#[derive(Debug, Serialize, Clone)]
pub struct CodexLocalUsageSummary {
  pub year: i32,
  pub year_total: UsageTotals,
  pub started_on: Option<String>,
  pub most_active_on: Option<String>,
  pub most_active_total_tokens: u64,
  pub streak_days: u64,
  pub active_days_year: u64,
  pub project_count_year: u64,
  pub turn_events_scanned: u64,
  pub today: UsageTotals,
  pub last7: UsageTotals,
  pub last30: UsageTotals,
  pub daily_last365: Vec<UsageDailyPoint>,
  pub by_model_last30: Vec<UsageBreakdown>,
  pub by_project_last30: Vec<UsageBreakdown>,
  pub by_model_year: Vec<UsageBreakdown>,
  pub by_project_year: Vec<UsageBreakdown>,
  pub sessions_path: String,
  pub sessions_dir_exists: bool,
  pub sessions_scanned: u64,
  pub token_events_scanned: u64,
}
