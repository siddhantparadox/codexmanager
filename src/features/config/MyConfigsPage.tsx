import { useEffect, useState } from "react";
import { listUserConfigs, readUserConfigText } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type { ConfigText, UserConfigSummary } from "../../lib/types";
import { useAppState } from "../../store/appStore";

export default function MyConfigsPage() {
  const { openPreview, setBusy, setError, busy, preview, lastAppliedAt } = useAppState();
  const [userConfigs, setUserConfigs] = useState<UserConfigSummary[]>([]);
  const [selectedUserConfig, setSelectedUserConfig] =
    useState<UserConfigSummary | null>(null);
  const [userConfigText, setUserConfigText] = useState<ConfigText | null>(null);
  const [userConfigDraft, setUserConfigDraft] = useState<string>("");
  const [newConfigName, setNewConfigName] = useState("");
  const [newConfigContent, setNewConfigContent] = useState("");
  const [pendingRefresh, setPendingRefresh] = useState(false);

  useEffect(() => {
    void loadUserConfigs();
  }, []);

  useEffect(() => {
    if (!lastAppliedAt) {
      return;
    }
    void loadUserConfigs(true);
  }, [lastAppliedAt]);

  useEffect(() => {
    if (pendingRefresh && !preview && !busy) {
      void loadUserConfigs(true);
      setPendingRefresh(false);
    }
  }, [pendingRefresh, preview, busy]);

  async function loadUserConfigs(silent = false) {
    if (!silent) {
      setBusy(true);
      setError(null);
    }
    try {
      const next = await listUserConfigs();
      const match = selectedUserConfig
        ? next.find((config) => config.id === selectedUserConfig.id)
        : null;
      setUserConfigs(next);
      if (selectedUserConfig) {
        if (match) {
          setSelectedUserConfig(match);
        } else {
          setSelectedUserConfig(null);
          setUserConfigText(null);
          setUserConfigDraft("");
        }
      }
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }

  async function handleUserConfigSelect(config: UserConfigSummary) {
    setSelectedUserConfig(config);
    setUserConfigText(null);
    setUserConfigDraft("");
    setBusy(true);
    setError(null);
    try {
      const text = await readUserConfigText(config.id);
      setUserConfigText(text);
      setUserConfigDraft(text.text);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  function queueRefresh() {
    setPendingRefresh(true);
  }

  return (
    <section className="split">
      <div className="panel">
        <div className="panel-header">
          <h2>My configs</h2>
          <span className="panel-meta">Saved presets</span>
        </div>
        <p className="panel-note">
          Personal presets stored in app data, ready to apply with a diff preview.
        </p>
        {userConfigs.length ? (
          <div className="list">
            {userConfigs.map((config) => (
              <button
                key={config.id}
                className={`list-item ${
                  selectedUserConfig?.id === config.id ? "active" : ""
                }`}
                onClick={() => handleUserConfigSelect(config)}
              >
                <div>
                  <p className="row-title">{config.name}</p>
                  <p className="row-meta">{config.modified ?? "Saved preset"}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="ghost">No saved configs yet.</p>
        )}
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Editor</h2>
          <span className="panel-meta">
            {selectedUserConfig ? selectedUserConfig.name : "Select a config"}
          </span>
        </div>
        {selectedUserConfig ? (
          <>
            <p className="panel-note">
              {userConfigText?.redacted
                ? "Sensitive values are masked and preserved on save."
                : "Edit cautiously and always preview the diff."}
            </p>
            <textarea
              className="editor"
              value={userConfigDraft}
              onChange={(event) => setUserConfigDraft(event.target.value)}
            />
            <div className="panel-actions">
              <button
                className="primary"
                onClick={() => {
                  queueRefresh();
                  void openPreview({
                    type: "save_user_config",
                    name: selectedUserConfig.id,
                    content: userConfigDraft
                  });
                }}
                disabled={!userConfigDraft.trim()}
              >
                Preview save
              </button>
              <button
                className="ghost-button"
                onClick={() =>
                  void openPreview({
                    type: "replace_config",
                    content: userConfigDraft
                  })
                }
                disabled={!userConfigDraft.trim()}
              >
                Preview apply to config
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  queueRefresh();
                  void openPreview({
                    type: "delete_user_config",
                    name: selectedUserConfig.id
                  });
                }}
              >
                Preview delete
              </button>
            </div>
          </>
        ) : (
          <p className="ghost">Select a saved config to edit.</p>
        )}
      </div>
      <div className="panel span-full">
        <div className="panel-header">
          <h2>Create config</h2>
          <span className="panel-meta">New preset</span>
        </div>
        <p className="panel-note">Names are saved as file-safe ids under app data.</p>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              value={newConfigName}
              onChange={(event) => setNewConfigName(event.target.value)}
              placeholder="my-config"
            />
          </label>
          <label className="span-2">
            Content (TOML)
            <textarea
              value={newConfigContent}
              onChange={(event) => setNewConfigContent(event.target.value)}
              placeholder='model = "gpt-5.2-codex"'
            />
          </label>
        </div>
        <div className="panel-actions">
          <button
            className="primary"
            onClick={() => {
              queueRefresh();
              void openPreview({
                type: "save_user_config",
                name: newConfigName,
                content: newConfigContent
              });
            }}
            disabled={!newConfigName.trim() || !newConfigContent.trim()}
          >
            Preview save
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              void openPreview({
                type: "replace_config",
                content: newConfigContent
              })
            }
            disabled={!newConfigContent.trim()}
          >
            Preview apply to config
          </button>
        </div>
      </div>
    </section>
  );
}
