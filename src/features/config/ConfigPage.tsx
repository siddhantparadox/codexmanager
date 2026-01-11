import { useEffect } from "react";
import ScalarRow from "./components/ScalarRow";
import { useAppState } from "../../store/appStore";
import type { ChangeRequest, ConfigScalar, ScalarValue } from "../../lib/types";

const INFO_LINKS = {
  model: {
    title: "To view available models, go to:",
    url: "https://developers.openai.com/codex/models/"
  },
  model_reasoning_effort: {
    title: "To view available reasoning effort values, go to:",
    url: "https://developers.openai.com/codex/config-reference/#configtoml:~:text=model_reasoning_effort"
  }
} as const;

export default function ConfigPage() {
  const {
    scan,
    configText,
    configDraft,
    scalarEdits,
    setConfigDraft,
    setScalarEdits,
    loadConfig,
    openPreview,
    setError
  } = useAppState();

  useEffect(() => {
    if (scan?.config.exists && !configText) {
      void loadConfig({ silent: true, showNotice: false });
    }
  }, [configText, loadConfig, scan?.config.exists]);

  return (
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
                info={INFO_LINKS[item.key as keyof typeof INFO_LINKS]}
                editValue={scalarEdits[item.key]}
                onEdit={(value) =>
                  setScalarEdits((prev) => ({
                    ...prev,
                    [item.key]: value
                  }))
                }
                onPreview={(value) => previewScalar(item, value, openPreview, setError)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Raw config</h2>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => void loadConfig()}>
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
              void openPreview({ type: "replace_config", content: configDraft })
            }
            disabled={!configDraft}
          >
            Preview raw change
          </button>
        </div>
      </div>
    </section>
  );
}

function previewScalar(
  item: ConfigScalar,
  rawValue: string,
  openPreview: (change: ChangeRequest) => Promise<boolean>,
  setError: (value: string | null) => void
) {
  const value = buildScalarValue(item.kind, rawValue);
  if (!value) {
    setError(`Invalid ${item.kind} value for ${item.key}.`);
    return;
  }
  setError(null);
  void openPreview({
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
