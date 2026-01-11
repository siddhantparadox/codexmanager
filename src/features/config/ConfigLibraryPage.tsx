import { useState } from "react";
import { useAppState } from "../../store/appStore";
import { openExternal } from "../../lib/openExternal";
import { PUBLIC_CONFIGS } from "./data/publicConfigs";

export default function ConfigLibraryPage() {
  const { openPreview } = useAppState();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-header">
          <h2>Public Config Library</h2>
          <span className="panel-meta">Curated presets</span>
        </div>
        <p className="panel-note">
          A place to find and apply public config files with a diff preview before
          any write.
        </p>
        <div className="list">
          {PUBLIC_CONFIGS.map((entry) => {
            const isOpen = Boolean(expanded[entry.id]);
            return (
              <div key={entry.id} className="library-item">
                <div className="row library-row">
                  <div className="row-body">
                    <p className="row-title">{entry.title}</p>
                    <a
                      className="row-link"
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(entry.url);
                      }}
                    >
                      {entry.url}
                    </a>
                    <p className="row-meta">{entry.summary}</p>
                  </div>
                  <div className="row-actions">
                    <button
                      className="ghost-button"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [entry.id]: !isOpen
                        }))
                      }
                    >
                      {isOpen ? "Hide" : "View"}
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        void openPreview({
                          type: "replace_config",
                          content: entry.config
                        })
                      }
                    >
                      Apply
                    </button>
                  </div>
                </div>
                {isOpen ? <pre className="code-block">{entry.config}</pre> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
