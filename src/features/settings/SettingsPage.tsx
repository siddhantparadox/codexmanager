import { useEffect, useMemo, useState } from "react";
import { codexGetUsageSnapshot } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type { CodexUsageSnapshot, UsageWindowView } from "../../lib/types";
import { useAppState } from "../../store/appStore";

export default function SettingsPage() {
  const { settingsDraft, setSettingsDraft, saveSettings, reloadSettings } =
    useAppState();
  const [usage, setUsage] = useState<CodexUsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [lastUsageRefresh, setLastUsageRefresh] = useState(0);
  const codexHome = settingsDraft?.codex_home?.trim() || undefined;
  const canRefreshUsage = Date.now() - lastUsageRefresh > 10_000;

  const usageMeta = useMemo(() => {
    if (!usage) return null;
    const parts = [];
    if (usage.plan_type) {
      parts.push(`Plan ${usage.plan_type}`);
    }
    if (usage.limit_reached) {
      parts.push("Limit reached");
    }
    return parts.length ? parts.join(" · ") : "Usage summary";
  }, [usage]);

  useEffect(() => {
    if (!settingsDraft) return;
    void refreshUsage(true);
  }, [codexHome, settingsDraft]);

  async function refreshUsage(force = false) {
    if (!force && !canRefreshUsage) {
      return;
    }
    setUsageLoading(true);
    setUsageError(null);
    try {
      const snapshot = await codexGetUsageSnapshot(codexHome);
      setUsage(snapshot);
      setLastUsageRefresh(Date.now());
    } catch (err) {
      setUsage(null);
      setUsageError(normalizeError(err));
    } finally {
      setUsageLoading(false);
    }
  }

  function renderWindow(label: string, window?: UsageWindowView) {
    if (!window) return null;
    const used = Math.round(window.used_percent);
    const remaining = Math.round(window.remaining_percent);
    return (
      <div className="usage-window" key={label}>
        <div className="usage-row">
          <span>{label}</span>
          <span>
            {remaining}% left
            {window.resets_in_human ? ` · resets in ${window.resets_in_human}` : ""}
          </span>
        </div>
        <div className="usage-bar">
          <div className="usage-bar-fill" style={{ width: `${used}%` }} />
        </div>
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-header">
          <h2>Locations</h2>
          <span className="panel-meta">Saved in app data</span>
        </div>
        {settingsDraft ? (
          <div className="form-grid">
            <label className="span-2">
              Codex home
              <input
                value={settingsDraft.codex_home}
                onChange={(event) =>
                  setSettingsDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          codex_home: event.target.value
                        }
                      : prev
                  )
                }
              />
            </label>
            <label className="span-2">
              Repo roots (one per line)
              <textarea
                value={settingsDraft.repo_roots.join("\n")}
                onChange={(event) =>
                  setSettingsDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          repo_roots: event.target.value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean)
                        }
                      : prev
                  )
                }
                placeholder="D:\\projects\\repo-a\nD:\\projects\\repo-b"
              />
            </label>
          </div>
        ) : (
          <p className="ghost">Loading settings.</p>
        )}
        <div className="panel-actions">
          <button
            className="primary"
            onClick={() => settingsDraft && void saveSettings(settingsDraft)}
          >
            Save settings
          </button>
          <button className="ghost-button" onClick={() => void reloadSettings()}>
            Reload
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Codex usage</h2>
          <div className="panel-actions">
            <button
              className="ghost-button"
              onClick={() => void refreshUsage()}
              disabled={!canRefreshUsage || usageLoading}
            >
              {usageLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <p className="panel-note">
          Usage is fetched from the Codex auth file and ChatGPT backend. Tokens
          never leave the backend.
        </p>
        {usageError ? (
          <div className="usage-error">
            <p>Could not load usage.</p>
            <p className="usage-error-detail">{usageError}</p>
          </div>
        ) : null}
        {usage ? (
          <div className="usage-card">
            <div className="usage-row">
              <span>{usageMeta}</span>
              <span>{usage.last_refresh ? `Last refresh ${usage.last_refresh}` : ""}</span>
            </div>
            <div className="usage-row">
              <span>Auth status</span>
              <span className="usage-status">{usage.auth_status}</span>
            </div>
            <div className="usage-meta">Auth file: {usage.auth_path}</div>
            <div className="usage-row">
              <span>Login method</span>
              <span>{usage.login_method}</span>
            </div>
            <div className="usage-row">
              <span>Token source</span>
              <span>{usage.token_source}</span>
            </div>
            {renderWindow("Primary window (5-hr window)", usage.primary)}
            {renderWindow("Secondary window (1 Week window)", usage.secondary)}
            {renderWindow("Code review", usage.code_review)}
            {usage.extras.length ? (
              <div className="usage-extras">
                <div className="usage-row">
                  <span>Credits / Balance</span>
                </div>
                {usage.extras.map(([key, value]) => (
                  <div key={key} className="usage-row">
                    <span>{key}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="ghost">
            {usageLoading ? "Loading usage..." : "No usage data yet."}
          </p>
        )}
      </div>
    </section>
  );
}
