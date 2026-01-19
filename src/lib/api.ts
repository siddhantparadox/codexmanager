import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyResult,
  BackupSummary,
  ChangeRequest,
  CodexLocalUsageSummary,
  CodexUsageSnapshot,
  ConfigText,
  PreviewResult,
  ScanState,
  Settings,
  SkillFileEntry,
  RemoteSkillDetail,
  RemoteSkillPage,
  UserConfigSummary
} from "./types";

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return invoke("update_settings", { settings });
}

export async function scanState(): Promise<ScanState> {
  return invoke("scan_state");
}

export async function readConfigText(): Promise<ConfigText> {
  return invoke("read_config_text");
}

export async function readSkillText(path: string): Promise<string> {
  return invoke("read_skill_text", { path });
}

export async function listSkillFiles(dir: string): Promise<SkillFileEntry[]> {
  return invoke("list_skill_files", { dir });
}

export async function listPublicSkills(
  query?: string | null,
  cursor?: string | null,
  limit?: number
): Promise<RemoteSkillPage> {
  return invoke("list_public_skills", {
    query: query ?? null,
    cursor: cursor ?? null,
    limit: limit ?? null
  });
}

export async function fetchPublicSkill(slug: string): Promise<RemoteSkillDetail> {
  return invoke("fetch_public_skill", { slug });
}

export async function listUserConfigs(): Promise<UserConfigSummary[]> {
  return invoke("list_user_configs");
}

export async function readUserConfigText(name: string): Promise<ConfigText> {
  return invoke("read_user_config_text", { name });
}

export async function previewChange(change: ChangeRequest): Promise<PreviewResult> {
  return invoke("preview_change", { change });
}

export async function applyChange(change: ChangeRequest): Promise<ApplyResult> {
  return invoke("apply_change", { change });
}

export async function listBackups(): Promise<BackupSummary[]> {
  return invoke("list_backups");
}

export async function deleteBackup(id: string): Promise<void> {
  return invoke("delete_backup", { id });
}

export async function deleteAllBackups(): Promise<void> {
  return invoke("delete_all_backups");
}

export async function exportWrappedPng(
  dataUrl: string,
  suggestedName?: string
): Promise<string | null> {
  return invoke("export_wrapped_png", {
    dataUrl,
    suggestedName: suggestedName ?? null
  });
}

export async function codexGetUsageSnapshot(
  codexHome?: string
): Promise<CodexUsageSnapshot> {
  return invoke("codex_get_usage_snapshot", { codexHome: codexHome ?? null });
}

export async function codexGetLocalUsageSummary(
  codexHome?: string
): Promise<CodexLocalUsageSummary> {
  return invoke("codex_get_local_usage_summary", { codexHome: codexHome ?? null });
}
