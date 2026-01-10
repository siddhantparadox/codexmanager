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
  path: string;
  scope: "user" | "repo";
  repo_root?: string | null;
  modified?: string | null;
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
};

export type ScalarValue = {
  kind: "string" | "integer" | "float" | "boolean";
  value: string | number | boolean;
};

export type ChangeRequest =
  | { type: "toggle_mcp_server"; name: string; enabled: boolean }
  | { type: "set_config_scalar"; key: string; value: ScalarValue }
  | { type: "replace_config"; content: string }
  | { type: "upsert_mcp_server"; name: string; table_toml: string }
  | { type: "delete_mcp_server"; name: string }
  | {
      type: "create_skill";
      scope: "user" | "repo";
      repo_root?: string | null;
      name: string;
      content: string;
    }
  | { type: "update_skill"; path: string; content: string }
  | { type: "delete_skill"; path: string }
  | { type: "save_user_config"; name: string; content: string }
  | { type: "delete_user_config"; name: string }
  | { type: "restore_backup"; backup_id: string };
