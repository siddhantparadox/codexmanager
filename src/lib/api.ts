import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyResult,
  BackupSummary,
  ChangeRequest,
  ConfigText,
  PreviewResult,
  ScanState,
  Settings
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

export async function previewChange(change: ChangeRequest): Promise<PreviewResult> {
  return invoke("preview_change", { change });
}

export async function applyChange(change: ChangeRequest): Promise<ApplyResult> {
  return invoke("apply_change", { change });
}

export async function listBackups(): Promise<BackupSummary[]> {
  return invoke("list_backups");
}