import { useAppState } from "../../store/appStore";

export default function SettingsPage() {
  const { settingsDraft, setSettingsDraft, saveSettings, reloadSettings } =
    useAppState();

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
    </section>
  );
}
