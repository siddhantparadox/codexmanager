import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  applyChange,
  getSettings,
  listBackups,
  previewChange,
  readConfigText,
  readSkillText,
  scanState,
  updateSettings
} from "./lib/api";
import type {
  ChangeRequest,
  ConfigScalar,
  ConfigText,
  PreviewResult,
  ScanState,
  ScalarValue,
  SkillSummary
} from "./lib/types";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "config", label: "Config" },
  { id: "mcp", label: "MCP Servers" },
  { id: "skills", label: "Skills" },
  { id: "backups", label: "Backups" },
  { id: "settings", label: "Settings" }
] as const;

type NavId = (typeof NAV_ITEMS)[number]["id"];

type SkillDraft = {
  name: string;
  scope: "user" | "repo";
  repo_root: string;
  content: string;
};

const NEW_SKILL_TEMPLATE = `---\nname: New Skill\ndescription: Short description\n---\n\n# New Skill\nDescribe behavior here.\n`;
const cardDelay = (delay: string): CSSProperties =>
  ({ "--delay": delay } as CSSProperties);

export default function App() {
  const [active, setActive] = useState<NavId>("dashboard");
  const [scan, setScan] = useState<ScanState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ScanState["settings"] | null>(
    null
  );
  const [configText, setConfigText] = useState<ConfigText | null>(null);
  const [configDraft, setConfigDraft] = useState<string>("");
  const [scalarEdits, setScalarEdits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pendingChange, setPendingChange] = useState<ChangeRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [skillText, setSkillText] = useState<string>("");
  const [newSkill, setNewSkill] = useState<SkillDraft>({
    name: "",
    scope: "user",
    repo_root: "",
    content: NEW_SKILL_TEMPLATE
  });
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpTable, setNewMcpTable] = useState("enabled = true\n");

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (scan?.settings) {
      setSettingsDraft(scan.settings);
    }
  }, [scan]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const next = await scanState();
      setScan(next);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadConfig() {
    setBusy(true);
    setError(null);
    try {
      const text = await readConfigText();
      setConfigText(text);
      setConfigDraft(text.text);
      setActive("config");
      setNotice("Config loaded.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(change: ChangeRequest) {
    setBusy(true);
    setError(null);
    try {
      const next = await previewChange(change);
      setPreview(next);
      setPendingChange(change);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (!pendingChange) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyChange(pendingChange);
      setNotice(`Applied: ${result.operation}`);
      setPreview(null);
      setPendingChange(null);
      await refresh();
      if (active === "config") {
        await loadConfig();
      }
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSkillSelect(skill: SkillSummary) {
    setSelectedSkill(skill);
    setSkillText("");
    setBusy(true);
    setError(null);
    try {
      const text = await readSkillText(skill.path);
      setSkillText(text);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSettingsSave() {
    if (!settingsDraft) return;
    setBusy(true);
    setError(null);
    try {
      await updateSettings(settingsDraft);
      await refresh();
      setNotice("Settings saved.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function reloadBackups() {
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
  }

  const dashboardStats = useMemo(() => {
    if (!scan) return null;
    return {
      mcpTotal: scan.config.mcp_servers.length,
      mcpDisabled: scan.config.mcp_servers.filter((mcp) => !mcp.enabled).length,
      skills: scan.skills.length,
      backups: scan.backups.length
    };
  }, [scan]);

  const diagnostics = scan?.diagnostics ?? [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CM</div>
          <div>
            <p className="brand-title">Codex Manager</p>
            <p className="brand-subtitle">Trust-first configuration desk</p>
          </div>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="foot-label">Codex home</p>
          <p className="foot-value">
            {scan?.settings.codex_home || "Not set"}
          </p>
          <button className="ghost-button" onClick={refresh} disabled={busy}>
            Refresh scan
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1 className="page-title">{labelFor(active)}</h1>
            <p className="page-subtitle">{subtitleFor(active)}</p>
          </div>
          <div className="topbar-meta">
            <div className="status-pill">
              <span className={`status-dot ${busy ? "busy" : "ready"}`} />
              {busy ? "Working" : "Ready"}
            </div>
            {notice ? <span className="notice">{notice}</span> : null}
          </div>
        </header>

        {error ? <div className="banner error">{error}</div> : null}

        {active === "dashboard" && (
          <section className="grid">
            <div className="card" style={cardDelay("0ms")}>
              <h3>Config status</h3>
              <p className="card-value">
                {scan?.config.exists ? "Detected" : "Missing"}
              </p>
              {scan?.config.parse_error ? (
                <p className="card-warning">Parse error in config.toml</p>
              ) : (
                <p className="card-note">Round-trip safe editing enabled.</p>
              )}
              <button className="ghost-button" onClick={loadConfig}>
                Load config
              </button>
            </div>
            <div className="card" style={cardDelay("80ms")}>
              <h3>MCP servers</h3>
              <p className="card-value">
                {dashboardStats?.mcpTotal ?? "-"}
              </p>
              <p className="card-note">
                {dashboardStats
                  ? `${dashboardStats.mcpDisabled} disabled`
                  : "Awaiting scan"}
              </p>
              <button className="ghost-button" onClick={() => setActive("mcp")}>
                See MCP
              </button>
            </div>
            <div className="card" style={cardDelay("160ms")}>
              <h3>Skills</h3>
              <p className="card-value">{dashboardStats?.skills ?? "-"}</p>
              <p className="card-note">User + repo scopes</p>
              <button className="ghost-button" onClick={() => setActive("skills")}>
                Manage skills
              </button>
            </div>
            <div className="card" style={cardDelay("240ms")}>
              <h3>Backups</h3>
              <p className="card-value">{dashboardStats?.backups ?? "-"}</p>
              <p className="card-note">Automatic safety snapshots</p>
              <button className="ghost-button" onClick={() => setActive("backups")}>
                View backups
              </button>
            </div>
            <div className="panel wide">
              <div className="panel-header">
                <h2>Diagnostics</h2>
                <span className="panel-meta">{diagnostics.length} alerts</span>
              </div>
              {diagnostics.length === 0 ? (
                <p className="ghost">No issues detected.</p>
              ) : (
                <ul className="list">
                  {diagnostics.map((item, idx) => (
                    <li key={`${item.message}-${idx}`}>
                      <span className={`badge ${item.level}`}>
                        {item.level.toUpperCase()}
                      </span>
                      <span className="list-text">{item.message}</span>
                      {item.path ? (
                        <span className="list-path">{item.path}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {active === "config" && (
          <section className="stack">
            <div className="panel">
              <div className="panel-header">
                <h2>Simple view</h2>
                <span className="panel-meta">Root scalar keys only</span>
              </div>
              <p className="panel-note">Sensitive keys are hidden here.</p>
              {!scan?.config.exists ? (
                <p className="ghost">No config.toml found.</p>
              ) : scan?.config.parse_error ? (
                <p className="card-warning">{scan.config.parse_error}</p>
              ) : (
                <div className="table">
                  <div className="table-head">
                    <span>Key</span>
                    <span>Value</span>
                    <span>Action</span>
                  </div>
                  {scan?.config.scalars.map((item) => (
                    <ScalarRow
                      key={item.key}
                      item={item}
                      editValue={scalarEdits[item.key]}
                      onEdit={(value) =>
                        setScalarEdits((prev) => ({
                          ...prev,
                          [item.key]: value
                        }))
                      }
                      onPreview={(value) =>
                        previewScalar(item, value, openPreview, setError)
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Raw config</h2>
                <div className="panel-actions">
                  <button className="ghost-button" onClick={loadConfig}>
                    Load
                  </button>
                </div>
              </div>
              <p className="panel-note">
                {configText?.redacted
                  ? "Sensitive values are masked. Applying preserves originals."
                  : "Edit cautiously and always preview the diff."}
              </p>
              <textarea
                className="editor"
                value={configDraft}
                onChange={(event) => setConfigDraft(event.target.value)}
                placeholder="Load config.toml to start editing."
              />
              <div className="panel-actions">
                <button
                  className="primary"
                  onClick={() =>
                    openPreview({ type: "replace_config", content: configDraft })
                  }
                  disabled={!configDraft}
                >
                  Preview raw change
                </button>
              </div>
            </div>
          </section>
        )}

        {active === "mcp" && (
          <section className="stack">
            <div className="panel">
              <div className="panel-header">
                <h2>MCP servers</h2>
                <span className="panel-meta">Toggle enabled flags only</span>
              </div>
              {!scan?.config.exists ? (
                <p className="ghost">No config.toml found.</p>
              ) : (
                <div className="list">
                  {scan?.config.mcp_servers.map((server) => (
                    <div key={server.name} className="row">
                      <div>
                        <p className="row-title">{server.name}</p>
                        <p className="row-meta">
                          {server.transport || "unknown transport"}
                        </p>
                      </div>
                      <div className="row-actions">
                        <span className={`badge ${server.enabled ? "good" : "warn"}`}>
                          {server.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            openPreview({
                              type: "toggle_mcp_server",
                              name: server.name,
                              enabled: !server.enabled
                            })
                          }
                        >
                          {server.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-header">
                <h2>Add MCP server</h2>
                <span className="panel-meta">Paste table body TOML</span>
              </div>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    value={newMcpName}
                    onChange={(event) => setNewMcpName(event.target.value)}
                    placeholder="server-name"
                  />
                </label>
                <label className="span-2">
                  Table body (TOML)
                  <textarea
                    value={newMcpTable}
                    onChange={(event) => setNewMcpTable(event.target.value)}
                    placeholder={
                      'enabled = true\ntransport = "stdio"\ncommand = "python"'
                    }
                  />
                </label>
              </div>
              <div className="panel-actions">
                <button
                  className="primary"
                  onClick={() =>
                    openPreview({
                      type: "upsert_mcp_server",
                      name: newMcpName,
                      table_toml: newMcpTable
                    })
                  }
                  disabled={!newMcpName.trim()}
                >
                  Preview add/update
                </button>
              </div>
            </div>
          </section>
        )}

        {active === "skills" && (
          <section className="split">
            <div className="panel">
              <div className="panel-header">
                <h2>Skills</h2>
                <span className="panel-meta">User + repo layers</span>
              </div>
              <div className="list">
                {scan?.skills.map((skill) => (
                  <button
                    key={skill.path}
                    className={`list-item ${selectedSkill?.path === skill.path ? "active" : ""}`}
                    onClick={() => handleSkillSelect(skill)}
                  >
                    <div>
                      <p className="row-title">{skill.name}</p>
                      <p className="row-meta">{skill.scope}</p>
                    </div>
                    <span className="list-path">{skill.path}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header">
                <h2>Editor</h2>
                <span className="panel-meta">
                  {selectedSkill ? selectedSkill.name : "Select a skill"}
                </span>
              </div>
              {selectedSkill ? (
                <>
                  <textarea
                    className="editor"
                    value={skillText}
                    onChange={(event) => setSkillText(event.target.value)}
                  />
                  <div className="panel-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        openPreview({
                          type: "update_skill",
                          path: selectedSkill.path,
                          content: skillText
                        })
                      }
                    >
                      Preview save
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        openPreview({
                          type: "delete_skill",
                          path: selectedSkill.path
                        })
                      }
                    >
                      Preview delete
                    </button>
                  </div>
                </>
              ) : (
                <p className="ghost">Select a skill to edit.</p>
              )}
            </div>
            <div className="panel span-full">
              <div className="panel-header">
                <h2>Create skill</h2>
                <span className="panel-meta">Templates are editable</span>
              </div>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    value={newSkill.name}
                    onChange={(event) =>
                      setNewSkill((prev) => ({
                        ...prev,
                        name: event.target.value
                      }))
                    }
                    placeholder="skill-name"
                  />
                </label>
                <label>
                  Scope
                  <select
                    value={newSkill.scope}
                    onChange={(event) =>
                      setNewSkill((prev) => ({
                        ...prev,
                        scope: event.target.value as SkillDraft["scope"]
                      }))
                    }
                  >
                    <option value="user">User</option>
                    <option value="repo">Repo</option>
                  </select>
                </label>
                {newSkill.scope === "repo" ? (
                  <label className="span-2">
                    Repo root
                    <input
                      value={newSkill.repo_root}
                      onChange={(event) =>
                        setNewSkill((prev) => ({
                          ...prev,
                          repo_root: event.target.value
                        }))
                      }
                      placeholder="D:\\projects\\myrepo"
                    />
                  </label>
                ) : null}
                <label className="span-2">
                  Content
                  <textarea
                    value={newSkill.content}
                    onChange={(event) =>
                      setNewSkill((prev) => ({
                        ...prev,
                        content: event.target.value
                      }))
                    }
                  />
                </label>
              </div>
              <div className="panel-actions">
                <button
                  className="primary"
                  onClick={() =>
                    openPreview({
                      type: "create_skill",
                      scope: newSkill.scope,
                      repo_root: newSkill.repo_root || null,
                      name: newSkill.name,
                      content: newSkill.content
                    })
                  }
                  disabled={!newSkill.name.trim()}
                >
                  Preview create
                </button>
              </div>
            </div>
          </section>
        )}

        {active === "backups" && (
          <section className="stack">
            <div className="panel">
              <div className="panel-header">
                <h2>Backups</h2>
                <div className="panel-actions">
                  <button className="ghost-button" onClick={reloadBackups}>
                    Refresh
                  </button>
                </div>
              </div>
              {scan?.backups.length ? (
                <div className="list">
                  {scan.backups.map((backup) => (
                    <div key={backup.id} className="row">
                      <div>
                        <p className="row-title">{backup.operation}</p>
                        <p className="row-meta">{backup.created_at}</p>
                      </div>
                      <div className="row-actions">
                        <span className="badge">{backup.files} files</span>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            openPreview({
                              type: "restore_backup",
                              backup_id: backup.id
                            })
                          }
                        >
                          Preview restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ghost">No backups recorded yet.</p>
              )}
            </div>
          </section>
        )}

        {active === "settings" && (
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
                <button className="primary" onClick={handleSettingsSave}>
                  Save settings
                </button>
                <button
                  className="ghost-button"
                  onClick={async () => {
                    const settings = await getSettings();
                    setSettingsDraft(settings);
                  }}
                >
                  Reload
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {preview ? (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-header">
              <h2>Preview: {preview.operation}</h2>
              <button className="ghost-button" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            {preview.warnings.length ? (
              <div className="warnings">
                {preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <pre className="diff">{preview.diff || "No changes."}</pre>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button className="primary" onClick={applyPending}>
                Apply change
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScalarRow({
  item,
  editValue,
  onEdit,
  onPreview
}: {
  item: ConfigScalar;
  editValue?: string;
  onEdit: (value: string) => void;
  onPreview: (value: string) => void;
}) {
  const displayValue = editValue ?? item.value;
  if (item.kind === "boolean") {
    const checked = displayValue.toLowerCase() === "true";
    return (
      <div className="table-row">
        <span>{item.key}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onEdit(String(event.target.checked))}
          />
          <span className="slider" />
        </label>
        <button className="ghost-button" onClick={() => onPreview(String(!checked))}>
          Preview
        </button>
      </div>
    );
  }

  return (
    <div className="table-row">
      <span>{item.key}</span>
      <input
        value={displayValue}
        onChange={(event) => onEdit(event.target.value)}
      />
      <button className="ghost-button" onClick={() => onPreview(displayValue)}>
        Preview
      </button>
    </div>
  );
}

function previewScalar(
  item: ConfigScalar,
  rawValue: string,
  openPreview: (change: ChangeRequest) => void,
  setError: (value: string | null) => void
) {
  const value = buildScalarValue(item.kind, rawValue);
  if (!value) {
    setError(`Invalid ${item.kind} value for ${item.key}.`);
    return;
  }
  setError(null);
  openPreview({
    type: "set_config_scalar",
    key: item.key,
    value
  });
}

function buildScalarValue(kind: ConfigScalar["kind"], value: string): ScalarValue | null {
  if (kind === "string") {
    return { kind, value };
  }
  if (kind === "integer") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return null;
    return { kind, value: parsed };
  }
  if (kind === "float") {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    return { kind, value: parsed };
  }
  if (kind === "boolean") {
    const normalized = value.toLowerCase();
    if (normalized !== "true" && normalized !== "false") return null;
    return { kind, value: normalized === "true" };
  }
  return null;
}

function normalizeError(error: unknown) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

function labelFor(page: NavId) {
  const item = NAV_ITEMS.find((nav) => nav.id === page);
  return item ? item.label : "Codex Manager";
}

function subtitleFor(page: NavId) {
  switch (page) {
    case "dashboard":
      return "A live snapshot of trust, safety, and scope.";
    case "config":
      return "Inspect and edit Codex config with guarded diffs.";
    case "mcp":
      return "Toggle servers and author new MCP entries.";
    case "skills":
      return "Edit SKILL.md assets across precedence layers.";
    case "backups":
      return "Restore from atomic backup manifests.";
    case "settings":
      return "Control paths and repo scopes.";
    default:
      return "";
  }
}
