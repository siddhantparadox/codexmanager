import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  codexGetLocalUsageSummary,
  codexGetUsageSnapshot,
  exportWrappedPng
} from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type {
  CodexLocalUsageSummary,
  CodexUsageSnapshot,
  UsageTotals,
  UsageWindowView
} from "../../lib/types";
import { useAppState } from "../../store/appStore";

const COST_PER_MILLION_TOKENS_USD = 1;

export default function SettingsPage() {
  const { settingsDraft, setSettingsDraft, saveSettings, reloadSettings } =
    useAppState();
  const [usage, setUsage] = useState<CodexUsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [lastUsageRefresh, setLastUsageRefresh] = useState(0);
  const [localUsage, setLocalUsage] = useState<CodexLocalUsageSummary | null>(null);
  const [localUsageError, setLocalUsageError] = useState<string | null>(null);
  const [localUsageLoading, setLocalUsageLoading] = useState(false);
  const [lastLocalUsageRefresh, setLastLocalUsageRefresh] = useState(0);
  const [exportingWrapped, setExportingWrapped] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const wrappedRef = useRef<HTMLDivElement | null>(null);
  const codexHome = settingsDraft?.codex_home?.trim() || undefined;
  const canRefreshUsage = Date.now() - lastUsageRefresh > 10_000;
  const canRefreshLocalUsage = Date.now() - lastLocalUsageRefresh > 10_000;
  const tokenFormatter = useMemo(() => new Intl.NumberFormat(), []);
  const costFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2
      }),
    []
  );
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
    []
  );
  const longDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      }),
    []
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: "long" }),
    []
  );

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

  useEffect(() => {
    setLocalUsage(null);
    setLocalUsageError(null);
    setLastLocalUsageRefresh(0);
    setExportPath(null);
    setExportError(null);
  }, [codexHome]);

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

  async function refreshLocalUsage(force = false) {
    if (!force && !canRefreshLocalUsage) {
      return;
    }
    setLocalUsageLoading(true);
    setLocalUsageError(null);
    try {
      const summary = await codexGetLocalUsageSummary(codexHome);
      setLocalUsage(summary);
      setLastLocalUsageRefresh(Date.now());
    } catch (err) {
      setLocalUsage(null);
      setLocalUsageError(normalizeError(err));
    } finally {
      setLocalUsageLoading(false);
    }
  }

  async function handleExportWrapped() {
    if (!localUsage || !wrappedRef.current || exportingWrapped) {
      return;
    }
    setExportError(null);
    setExportPath(null);
    setExportingWrapped(true);
    try {
      if ("fonts" in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const panel = wrappedRef.current;
      const panelStyle = getComputedStyle(panel);
      let backgroundColor = panelStyle.backgroundColor;
      if (
        backgroundColor === "transparent" ||
        backgroundColor === "rgba(0, 0, 0, 0)"
      ) {
        const parent = panel.parentElement;
        if (parent) {
          backgroundColor = getComputedStyle(parent).backgroundColor;
        }
      }
      const dataUrl = await toPng(panel, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor
      });
      const suggestedName = `codex-wrapped-${localUsage.year}.png`;
      const path = await exportWrappedPng(dataUrl, suggestedName);
      if (path) {
        setExportPath(path);
      }
    } catch (err) {
      setExportError(normalizeError(err));
    } finally {
      setExportingWrapped(false);
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

  function formatTokens(value?: number) {
    return tokenFormatter.format(value ?? 0);
  }

  function formatCost(value: number) {
    return costFormatter.format(value);
  }

  function estimateCost(totals: UsageTotals) {
    return (totals.total_tokens / 1_000_000) * COST_PER_MILLION_TOKENS_USD;
  }

  function parseLocalDate(value?: string | null) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function formatShortDate(value?: string | null) {
    const date = parseLocalDate(value);
    return date ? shortDateFormatter.format(date) : "—";
  }

  function formatLongDate(value?: string | null) {
    const date = parseLocalDate(value);
    return date ? longDateFormatter.format(date) : "—";
  }

  function formatWeekday(value?: string | null) {
    const date = parseLocalDate(value);
    return date ? weekdayFormatter.format(date) : "—";
  }

  function daysAgo(value?: string | null) {
    const date = parseLocalDate(value);
    if (!date) return null;
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 0) return null;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function renderTotals(label: string, totals: UsageTotals) {
    const outputLabel = totals.reasoning_output_tokens
      ? `${formatTokens(totals.output_tokens)} (${formatTokens(
          totals.reasoning_output_tokens
        )} reasoning)`
      : formatTokens(totals.output_tokens);
    return (
      <div className="usage-summary-card" key={label}>
        <div className="usage-summary-label">{label}</div>
        <div className="usage-summary-value">{formatTokens(totals.total_tokens)}</div>
        <div className="usage-summary-meta">
          <span>
            In {formatTokens(totals.input_tokens)} · Cached{" "}
            {formatTokens(totals.cached_input_tokens)} · Out {outputLabel}
          </span>
          <span className="usage-summary-cost">
            Cost est: {formatCost(estimateCost(totals))}
          </span>
        </div>
      </div>
    );
  }

  const localUsageNote = useMemo(() => {
    if (!localUsage) return null;
    if (!localUsage.sessions_dir_exists) {
      return "No sessions directory found. History persistence may be disabled.";
    }
    if (localUsage.token_events_scanned === 0) {
      return "No token_count events found in session logs. Older sessions might not emit usage metrics.";
    }
    return null;
  }, [localUsage]);

  const cacheRatio = useMemo(() => {
    if (!localUsage) return null;
    const denom =
      localUsage.last30.input_tokens + localUsage.last30.cached_input_tokens;
    if (!denom) return null;
    return Math.round((localUsage.last30.cached_input_tokens / denom) * 100);
  }, [localUsage]);
  const cacheRatioYear = useMemo(() => {
    if (!localUsage) return null;
    const denom =
      localUsage.year_total.input_tokens + localUsage.year_total.cached_input_tokens;
    if (!denom) return null;
    return Math.round((localUsage.year_total.cached_input_tokens / denom) * 100);
  }, [localUsage]);
  const avgTokensPerActiveDay = useMemo(() => {
    if (!localUsage || localUsage.active_days_year === 0) return null;
    return Math.round(localUsage.year_total.total_tokens / localUsage.active_days_year);
  }, [localUsage]);
  const avgTokensPerSession = useMemo(() => {
    if (!localUsage || localUsage.sessions_scanned === 0) return null;
    return Math.round(localUsage.year_total.total_tokens / localUsage.sessions_scanned);
  }, [localUsage]);

  const wrappedYear = localUsage?.year ?? new Date().getFullYear();
  const wrappedStartedAgo = daysAgo(localUsage?.started_on ?? null);
  const wrappedWeekly = useMemo(() => {
    if (!localUsage) return [];
    return localUsage.daily_last365.slice(-7).map((day) => ({
      ...day,
      label: formatWeekday(day.date).slice(0, 3)
    }));
  }, [localUsage, weekdayFormatter]);
  const wrappedWeeklyMax = useMemo(() => {
    if (!wrappedWeekly.length) return 0;
    return wrappedWeekly.reduce(
      (acc, day) => Math.max(acc, day.total_tokens),
      0
    );
  }, [wrappedWeekly]);
  const heatmapData = useMemo(() => {
    if (!localUsage) return { cells: [], max: 0, yearDays: 0 };
    const today = new Date();
    const yearStart = new Date(localUsage.year, 0, 1);
    const yearEnd = new Date(localUsage.year, 11, 31);
    const dayMap = new Map(
      localUsage.daily_last365.map((day) => [day.date, day.total_tokens])
    );
    const offset = yearStart.getDay();
    const cells = Array.from({ length: offset }, () => ({
      empty: true,
      date: "",
      total: 0,
      future: false
    }));
    let max = 0;
    let cursor = new Date(yearStart);
    let yearDays = 0;
    while (cursor <= yearEnd) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(cursor.getDate()).padStart(2, "0")}`;
      const total = dayMap.get(key) ?? 0;
      if (total > max) {
        max = total;
      }
      const future = cursor > today;
      cells.push({ empty: false, date: key, total, future });
      yearDays += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { cells, max, yearDays };
  }, [localUsage]);

  function heatLevel(value: number, max: number) {
    if (!max || value === 0) return 0;
    const ratio = value / max;
    if (ratio >= 0.75) return 4;
    if (ratio >= 0.5) return 3;
    if (ratio >= 0.25) return 2;
    return 1;
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
          Plan usage is fetched from the Codex auth file and ChatGPT backend.
          Local session analytics are computed from CODEX_HOME logs on this
          device.
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
        <div className="usage-divider" />
        <div className="usage-card usage-advanced">
          <div className="usage-advanced-header">
            <div className="usage-advanced-text">
              <div className="usage-advanced-title">Local usage analytics</div>
              <div className="usage-meta">
                Scans {localUsage?.sessions_path ?? "CODEX_HOME/sessions"} JSONL
                logs. No network.
              </div>
            </div>
            <button
              className="ghost-button"
              onClick={() => void refreshLocalUsage()}
              disabled={!canRefreshLocalUsage || localUsageLoading}
            >
              {localUsageLoading
                ? "Scanning..."
                : localUsage
                  ? "Refresh usage"
                  : "Show usage"}
            </button>
          </div>
          {localUsageError ? (
            <div className="usage-error">
              <p>Could not load local usage.</p>
              <p className="usage-error-detail">{localUsageError}</p>
            </div>
          ) : null}
          {localUsage ? (
            <>
              {localUsageNote ? <p className="usage-note">{localUsageNote}</p> : null}
              <div className="usage-meta-row">
                <span>Sessions scanned: {formatTokens(localUsage.sessions_scanned)}</span>
                <span>Token events: {formatTokens(localUsage.token_events_scanned)}</span>
                {cacheRatio === null ? null : (
                  <span>Cache ratio (30d): {cacheRatio}%</span>
                )}
                <span>Year window: Jan 1 – today</span>
              </div>
              <div className="usage-summary-grid">
                {renderTotals("Today", localUsage.today)}
                {renderTotals("Last 7 days", localUsage.last7)}
                {renderTotals("Last 30 days", localUsage.last30)}
                {renderTotals(`${localUsage.year} YTD`, localUsage.year_total)}
              </div>
              <div className="usage-breakdowns">
                <div className="usage-breakdown">
                  <div className="usage-breakdown-title">Top models (30d)</div>
                  {localUsage.by_model_last30.length ? (
                    <div className="usage-table">
                      <div className="usage-table-head">
                        <span>Model</span>
                        <span>Tokens</span>
                      </div>
                      {localUsage.by_model_last30.map((item) => (
                        <div className="usage-table-row" key={item.key}>
                          <span className="usage-table-key">{item.key}</span>
                          <span>{formatTokens(item.totals.total_tokens)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ghost">No model usage yet.</p>
                  )}
                </div>
                <div className="usage-breakdown">
                  <div className="usage-breakdown-title">Top projects (30d)</div>
                  {localUsage.by_project_last30.length ? (
                    <div className="usage-table">
                      <div className="usage-table-head">
                        <span>Project</span>
                        <span>Tokens</span>
                      </div>
                      {localUsage.by_project_last30.map((item) => (
                        <div className="usage-table-row" key={item.key}>
                          <span className="usage-table-key">{item.key}</span>
                          <span>{formatTokens(item.totals.total_tokens)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ghost">No project usage yet.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="ghost">
              {localUsageLoading
                ? "Scanning local logs..."
                : "Click \"Show usage\" to scan local session logs."}
            </p>
          )}
        </div>
      </div>
      <div
        className={`panel usage-wrapped-panel${exportingWrapped ? " exporting" : ""}`}
      >
        <div className="usage-wrapped-header">
          <div>
            <h2>Usage wrapped</h2>
            <span className="panel-meta">Local session story for {wrappedYear}</span>
          </div>
          <div className="usage-wrapped-actions">
            <span className="wrapped-badge">Wrapped {wrappedYear}</span>
            <button
              className="ghost-button"
              onClick={() => void refreshLocalUsage()}
              disabled={!canRefreshLocalUsage || localUsageLoading}
            >
              {localUsageLoading
                ? "Scanning..."
                : localUsage
                  ? "Refresh usage"
                  : "Show usage"}
            </button>
            <button
              className="ghost-button"
              onClick={() => void handleExportWrapped()}
              disabled={!localUsage || exportingWrapped}
            >
              {exportingWrapped ? "Exporting..." : "Export PNG"}
            </button>
          </div>
        </div>
        <p className="panel-note">
          Built from CODEX_HOME session logs. No network calls.
        </p>
        {exportPath ? (
          <div className="wrapped-export-status">
            Exported to <span className="wrapped-export-path">{exportPath}</span>
          </div>
        ) : null}
        {exportError ? (
          <div className="usage-error">
            <p>Could not export PNG.</p>
            <p className="usage-error-detail">{exportError}</p>
          </div>
        ) : null}
        {!localUsage ? (
          <p className="ghost">
            {localUsageLoading
              ? "Scanning local logs..."
              : "Load local usage to see the wrapped view."}
          </p>
        ) : (
          <div className="usage-wrapped-body" ref={wrappedRef}>
            <div className="wrapped-top-grid">
              <div className="wrapped-card">
                <div className="wrapped-card-title">Started</div>
                <div className="wrapped-card-value">
                  {formatLongDate(localUsage.started_on ?? null)}
                </div>
                <div className="wrapped-card-meta">
                  {wrappedStartedAgo === null
                    ? "No activity yet"
                    : `${wrappedStartedAgo} days ago`}
                </div>
              </div>
              <div className="wrapped-card">
                <div className="wrapped-card-title">Most active day</div>
                <div className="wrapped-card-value">
                  {formatWeekday(localUsage.most_active_on ?? null)}
                </div>
                <div className="wrapped-card-meta">
                  {formatShortDate(localUsage.most_active_on ?? null)} ·{" "}
                  {formatTokens(localUsage.most_active_total_tokens)} tokens
                </div>
              </div>
              <div className="wrapped-card">
                <div className="wrapped-card-title">Weekly</div>
                <div className="wrapped-weekly-bars">
                  {wrappedWeekly.map((day) => {
                    const height =
                      wrappedWeeklyMax === 0
                        ? 0
                        : Math.round((day.total_tokens / wrappedWeeklyMax) * 100);
                    return (
                      <div className="wrapped-weekly-bar" key={day.date}>
                        <span className="wrapped-weekly-tooltip">
                          {formatTokens(day.total_tokens)} tokens
                        </span>
                        <div className="wrapped-weekly-bar-track">
                          <div
                            className="wrapped-weekly-bar-fill"
                            style={{ height: `${height}%` }}
                          />
                        </div>
                        <span className="wrapped-weekly-bar-label">
                          {day.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="wrapped-heatmap-card">
              <div className="wrapped-heatmap-header">
                <span>Activity</span>
                <span className="wrapped-heatmap-meta">
                  {localUsage.active_days_year} active days ·{" "}
                  {formatTokens(localUsage.year_total.total_tokens)} tokens ·{" "}
                  {heatmapData.yearDays} days
                </span>
              </div>
              <div className="wrapped-heatmap-months">
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
                  (label) => (
                    <span key={label}>{label}</span>
                  )
                )}
              </div>
              <div className="wrapped-heatmap-grid">
                {heatmapData.cells.map((cell, index) => {
                  if (cell.empty) {
                    return <span key={`empty-${index}`} className="wrapped-heatmap-cell empty" />;
                  }
                  const level = heatLevel(cell.total, heatmapData.max);
                  const isEmpty = cell.total === 0 || cell.future;
                  return (
                    <span
                      key={cell.date}
                      className={`wrapped-heatmap-cell ${isEmpty ? "heat-empty" : `heat-${level}`}`}
                      title={`${cell.date}: ${formatTokens(cell.total)} tokens`}
                    />
                  );
                })}
              </div>
              <div className="wrapped-heatmap-legend">
                <span>Less</span>
                <span className="wrapped-heatmap-cell heat-empty" />
                <span className="wrapped-heatmap-cell heat-1" />
                <span className="wrapped-heatmap-cell heat-2" />
                <span className="wrapped-heatmap-cell heat-3" />
                <span className="wrapped-heatmap-cell heat-4" />
                <span>More</span>
              </div>
            </div>

            <div className="wrapped-mid-grid">
              <div className="wrapped-card">
                <div className="wrapped-card-title">Top models (YTD)</div>
                {localUsage.by_model_year.length ? (
                  <div className="wrapped-list">
                    {localUsage.by_model_year.map((item) => (
                      <div key={item.key} className="wrapped-list-row">
                        <span className="wrapped-list-key">{item.key}</span>
                        <span>{formatTokens(item.totals.total_tokens)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ghost">No model usage yet.</p>
                )}
              </div>
              <div className="wrapped-card">
                <div className="wrapped-card-title">Usage detail (YTD)</div>
                <div className="wrapped-list">
                  <div className="wrapped-list-row">
                    <span>Input</span>
                    <span>{formatTokens(localUsage.year_total.input_tokens)}</span>
                  </div>
                  <div className="wrapped-list-row">
                    <span>Cache read</span>
                    <span>
                      {formatTokens(localUsage.year_total.cached_input_tokens)}
                    </span>
                  </div>
                  <div className="wrapped-list-row">
                    <span>Output</span>
                    <span>{formatTokens(localUsage.year_total.output_tokens)}</span>
                  </div>
                  <div className="wrapped-list-row">
                    <span>Reasoning</span>
                    <span>
                      {formatTokens(localUsage.year_total.reasoning_output_tokens)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="wrapped-metrics-grid">
              <div className="wrapped-metric">
                <div className="wrapped-metric-label">Sessions</div>
                <div className="wrapped-metric-value">
                  {formatTokens(localUsage.sessions_scanned)}
                </div>
              </div>
              <div className="wrapped-metric">
                <div className="wrapped-metric-label">Turns</div>
                <div className="wrapped-metric-value">
                  {formatTokens(localUsage.turn_events_scanned)}
                </div>
              </div>
              <div className="wrapped-metric">
                <div className="wrapped-metric-label">Projects</div>
                <div className="wrapped-metric-value">
                  {formatTokens(localUsage.project_count_year)}
                </div>
              </div>
              <div className="wrapped-metric">
                <div className="wrapped-metric-label">Streak</div>
                <div className="wrapped-metric-value">
                  {localUsage.streak_days}d
                </div>
              </div>
              <div className="wrapped-metric wide">
                <div className="wrapped-metric-label">
                  Total tokens (YTD) · Cost est:{" "}
                  {formatCost(estimateCost(localUsage.year_total))}
                </div>
                <div className="wrapped-metric-value">
                  {formatTokens(localUsage.year_total.total_tokens)}
                </div>
              </div>
              <div className="wrapped-metric wide">
                <div className="wrapped-metric-label">Usage cost (YTD)</div>
                <div className="wrapped-metric-value">
                  {formatCost(estimateCost(localUsage.year_total))}
                </div>
              </div>
            </div>
            <div className="wrapped-export-stats">
              <div className="wrapped-export-stats-title">
                Local analytics snapshot
              </div>
              <div className="wrapped-export-stats-grid">
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Today</span>
                  <span className="wrapped-export-stat-value">
                    {formatTokens(localUsage.today.total_tokens)}
                  </span>
                  <span className="wrapped-export-stat-meta">
                    Cost est: {formatCost(estimateCost(localUsage.today))}
                  </span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Last 7 days</span>
                  <span className="wrapped-export-stat-value">
                    {formatTokens(localUsage.last7.total_tokens)}
                  </span>
                  <span className="wrapped-export-stat-meta">
                    Cost est: {formatCost(estimateCost(localUsage.last7))}
                  </span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Last 30 days</span>
                  <span className="wrapped-export-stat-value">
                    {formatTokens(localUsage.last30.total_tokens)}
                  </span>
                  <span className="wrapped-export-stat-meta">
                    Cost est: {formatCost(estimateCost(localUsage.last30))}
                  </span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Token events</span>
                  <span className="wrapped-export-stat-value">
                    {formatTokens(localUsage.token_events_scanned)}
                  </span>
                  <span className="wrapped-export-stat-meta">Local log count</span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Cache ratio (30d)</span>
                  <span className="wrapped-export-stat-value">
                    {cacheRatio === null ? "—" : `${cacheRatio}%`}
                  </span>
                  <span className="wrapped-export-stat-meta">
                    Cached vs input tokens
                  </span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">Cache ratio (YTD)</span>
                  <span className="wrapped-export-stat-value">
                    {cacheRatioYear === null ? "—" : `${cacheRatioYear}%`}
                  </span>
                  <span className="wrapped-export-stat-meta">
                    Cached vs input tokens
                  </span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">
                    Avg tokens / active day
                  </span>
                  <span className="wrapped-export-stat-value">
                    {avgTokensPerActiveDay === null
                      ? "—"
                      : formatTokens(avgTokensPerActiveDay)}
                  </span>
                  <span className="wrapped-export-stat-meta">Year to date</span>
                </div>
                <div className="wrapped-export-stat">
                  <span className="wrapped-export-stat-label">
                    Avg tokens / session
                  </span>
                  <span className="wrapped-export-stat-value">
                    {avgTokensPerSession === null
                      ? "—"
                      : formatTokens(avgTokensPerSession)}
                  </span>
                  <span className="wrapped-export-stat-meta">Year to date</span>
                </div>
              </div>
            </div>
            <div className="wrapped-export-footer">
              Codex Manager · Local usage wrapped · {wrappedYear}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
