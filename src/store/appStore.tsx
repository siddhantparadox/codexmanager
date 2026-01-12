import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  applyChange,
  getSettings,
  listBackups,
  previewChange,
  readConfigText,
  scanState,
  updateSettings
} from "../lib/api";
import { normalizeError } from "../lib/errors";
import type { ChangeRequest, ConfigText, PreviewResult, ScanState } from "../lib/types";

type LoadConfigOptions = {
  silent?: boolean;
  showNotice?: boolean;
};

type AppStore = {
  scan: ScanState | null;
  settingsDraft: ScanState["settings"] | null;
  configText: ConfigText | null;
  configDraft: string;
  scalarEdits: Record<string, string>;
  preview: PreviewResult | null;
  pendingChange: ChangeRequest | null;
  lastAppliedAt: number;
  busy: boolean;
  notice: string | null;
  error: string | null;
  setSettingsDraft: React.Dispatch<React.SetStateAction<ScanState["settings"] | null>>;
  setConfigDraft: React.Dispatch<React.SetStateAction<string>>;
  setScalarEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  refresh: (silent?: boolean) => Promise<void>;
  loadConfig: (options?: LoadConfigOptions) => Promise<boolean>;
  openPreview: (change: ChangeRequest) => Promise<boolean>;
  applyPending: () => Promise<boolean>;
  closePreview: () => void;
  reloadBackups: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  saveSettings: (settings: ScanState["settings"]) => Promise<boolean>;
};

const AppContext = createContext<AppStore | null>(null);

const CONFIG_CHANGE_TYPES: ChangeRequest["type"][] = [
  "toggle_mcp_server",
  "set_config_scalar",
  "replace_config",
  "upsert_mcp_server",
  "delete_mcp_server",
  "restore_backup"
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ScanState["settings"] | null>(
    null
  );
  const [configText, setConfigText] = useState<ConfigText | null>(null);
  const [configDraft, setConfigDraft] = useState<string>("");
  const [scalarEdits, setScalarEdits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pendingChange, setPendingChange] = useState<ChangeRequest | null>(null);
  const [lastAppliedAt, setLastAppliedAt] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setBusy(true);
    }
    setError(null);
    try {
      const next = await scanState();
      setScan(next);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }, []);

  const loadConfig = useCallback(
    async (options: LoadConfigOptions = {}) => {
      const { silent = false, showNotice = true } = options;
      if (!silent) {
        setBusy(true);
      }
      setError(null);
      try {
        const text = await readConfigText();
        setConfigText(text);
        setConfigDraft(text.text);
        if (showNotice) {
          setNotice("Config loaded.");
        }
        return true;
      } catch (err) {
        setError(normalizeError(err));
        return false;
      } finally {
        if (!silent) {
          setBusy(false);
        }
      }
    },
    []
  );

  const openPreview = useCallback(async (change: ChangeRequest) => {
    setBusy(true);
    setError(null);
    try {
      const next = await previewChange(change);
      setPreview(next);
      setPendingChange(change);
      return true;
    } catch (err) {
      setError(normalizeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
    setPendingChange(null);
  }, []);

  const applyPending = useCallback(async () => {
    if (!pendingChange) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await applyChange(pendingChange);
      setNotice(`Applied: ${result.operation}`);
      setPreview(null);
      setPendingChange(null);
      await refresh(true);
      if (configText && CONFIG_CHANGE_TYPES.includes(pendingChange.type)) {
        await loadConfig({ silent: true, showNotice: false });
      }
      setLastAppliedAt(Date.now());
      return true;
    } catch (err) {
      setError(normalizeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [configText, loadConfig, pendingChange, refresh]);

  const reloadBackups = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const backups = await listBackups();
      setScan((prev) => (prev ? { ...prev, backups } : prev));
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const settings = await getSettings();
      setSettingsDraft(settings);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveSettings = useCallback(
    async (settings: ScanState["settings"]) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await updateSettings(settings);
        setSettingsDraft(saved);
        await refresh(true);
        setNotice("Settings saved.");
        return true;
      } catch (err) {
        setError(normalizeError(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (scan?.settings) {
      setSettingsDraft(scan.settings);
    }
  }, [scan]);

  const value = useMemo<AppStore>(
    () => ({
      scan,
      settingsDraft,
      configText,
      configDraft,
      scalarEdits,
      preview,
      pendingChange,
      lastAppliedAt,
      busy,
      notice,
      error,
      setSettingsDraft,
      setConfigDraft,
      setScalarEdits,
      setBusy,
      setNotice,
      setError,
      refresh,
      loadConfig,
      openPreview,
      applyPending,
      closePreview,
      reloadBackups,
      reloadSettings,
      saveSettings
    }),
    [
      scan,
      settingsDraft,
      configText,
      configDraft,
      scalarEdits,
      preview,
      pendingChange,
      busy,
      notice,
      error,
      refresh,
      loadConfig,
      openPreview,
      applyPending,
      closePreview,
      reloadBackups,
      reloadSettings,
      saveSettings
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
