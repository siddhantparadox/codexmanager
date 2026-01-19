export type Settings = {
  codex_home: string;
  repo_roots: string[];
  cli_path?: string | null;
};

export type ConfigScalar = {
  key: string;
  kind: "string" | "integer" | "float" | "boolean";
  value: string;
};

export type McpServer = {
  name: string;
  enabled: boolean;
  transport?: string | null;
};

export type SkillSummary = {
  id: string;
  name: string;
  description?: string | null;
  dir: string;
  path: string;
  scope: "user" | "repo";
  repo_root?: string | null;
  modified?: string | null;
  counts: SkillFileCounts;
  warnings: string[];
};

export type SkillFileCounts = {
  skill_md: number;
  references: number;
  scripts: number;
  assets: number;
  other: number;
};

export type SkillFileEntry = {
  path: string;
  relative_path: string;
  kind: "file" | "dir";
  size?: number | null;
  category: "skill_md" | "references" | "scripts" | "assets" | "other";
};

export type RemoteSkillDetail = {
  slug: string;
  name: string;
  description?: string | null;
  tags: string[];
  updated_at?: string | null;
  skill_md?: string | null;
  files: string[];
  download_url?: string | null;
  source_url?: string | null;
};

export type RemoteSkillSummary = {
  slug: string;
  name: string;
  description?: string | null;
  tags: string[];
  updated_at?: string | null;
};

export type RemoteSkillPage = {
  items: RemoteSkillSummary[];
  next_cursor?: string | null;
};

export type UserConfigSummary = {
  id: string;
  name: string;
  modified?: string | null;
};

export type Diagnostic = {
  level: "info" | "warn" | "error";
  message: string;
  path?: string | null;
};

export type ConfigSummary = {
  path: string;
  exists: boolean;
  parse_error?: string | null;
  scalars: ConfigScalar[];
  mcp_servers: McpServer[];
};

export type BackupSummary = {
  id: string;
  created_at: string;
  operation: string;
  files: number;
};

export type UsageWindowView = {
  used_percent: number;
  remaining_percent: number;
  window_seconds?: number;
  resets_in_seconds?: number;
  resets_in_human?: string;
};

export type CodexUsageSnapshot = {
  plan_type?: string;
  primary?: UsageWindowView;
  secondary?: UsageWindowView;
  code_review?: UsageWindowView;
  limit_reached?: boolean;
  extras: Array<[string, string]>;
  auth_path: string;
  auth_status: string;
  login_method: string;
  token_source: string;
  last_refresh?: string;
};

export type UsageTotals = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type UsageDailyPoint = {
  date: string;
  total_tokens: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

export type UsageBreakdown = {
  key: string;
  totals: UsageTotals;
};

export type CodexLocalUsageSummary = {
  year: number;
  year_total: UsageTotals;
  started_on?: string | null;
  most_active_on?: string | null;
  most_active_total_tokens: number;
  streak_days: number;
  active_days_year: number;
  project_count_year: number;
  turn_events_scanned: number;
  today: UsageTotals;
  last7: UsageTotals;
  last30: UsageTotals;
  daily_last365: UsageDailyPoint[];
  by_model_last30: UsageBreakdown[];
  by_project_last30: UsageBreakdown[];
  by_model_year: UsageBreakdown[];
  by_project_year: UsageBreakdown[];
  sessions_path: string;
  sessions_dir_exists: boolean;
  sessions_scanned: number;
  token_events_scanned: number;
};

export type ScanState = {
  settings: Settings;
  config: ConfigSummary;
  skills: SkillSummary[];
  diagnostics: Diagnostic[];
  backups: BackupSummary[];
};

export type PreviewFile = {
  path: string;
  exists: boolean;
};

export type PreviewResult = {
  operation: string;
  diff: string;
  warnings: string[];
  files: PreviewFile[];
};

export type ApplyResult = {
  backup_id: string | null;
  operation: string;
};

export type ConfigText = {
  text: string;
  redacted: boolean;
  parsed?: JsonValue | null;
  parse_error?: string | null;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ScalarValue = {
  kind: "string" | "integer" | "float" | "boolean";
  value: string | number | boolean;
};

export type SkillFolderSpec = {
  enabled: boolean;
  files: string[];
};

export type SkillFolderConfig = {
  scripts: SkillFolderSpec;
  references: SkillFolderSpec;
  assets: SkillFolderSpec;
};

export type InstallMode = "overlay" | "replace" | "sync";

export type ChangeRequest =
  | { type: "toggle_mcp_server"; name: string; enabled: boolean }
  | { type: "set_config_scalar"; key: string; value: ScalarValue }
  | { type: "set_config_path"; path: string[]; value: ScalarValue }
  | { type: "replace_config"; content: string }
  | { type: "upsert_mcp_server"; name: string; table_toml: string }
  | { type: "delete_mcp_server"; name: string }
  | {
      type: "create_skill";
      scope: "user" | "repo";
      repo_root?: string | null;
      name: string;
      content: string;
      folders: SkillFolderConfig;
    }
  | { type: "update_skill"; path: string; content: string }
  | { type: "delete_skill"; path: string }
  | { type: "delete_skill_folder"; dir: string }
  | {
      type: "install_remote_skill";
      slug: string;
      scope: "user" | "repo";
      repo_root?: string | null;
      mode: InstallMode;
    }
  | { type: "save_user_config"; name: string; content: string }
  | { type: "delete_user_config"; name: string }
  | { type: "restore_backup"; backup_id: string };
