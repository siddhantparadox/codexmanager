import type { ConfigScalar } from "../../../lib/types";

export type InfoLink = {
  title: string;
  url: string;
};

type ScalarRowProps = {
  item: ConfigScalar;
  editValue?: string;
  info?: InfoLink;
  onEdit: (value: string) => void;
  onPreview: (value: string) => void;
};

export default function ScalarRow({
  item,
  editValue,
  info,
  onEdit,
  onPreview
}: ScalarRowProps) {
  const displayValue = editValue ?? item.value;
  const keyLabel = (
    <span className="table-key">
      <span className="key-text">{item.key}</span>
      {info ? (
        <span className="info-hint" tabIndex={0} aria-label={`${info.title} ${info.url}`}>
          <span className="info-icon" aria-hidden="true">
            i
          </span>
          <span className="info-tooltip">
            <span className="info-title">{info.title}</span>
            <span className="info-url">{info.url}</span>
          </span>
        </span>
      ) : null}
    </span>
  );

  if (item.kind === "boolean") {
    const checked = displayValue.toLowerCase() === "true";
    return (
      <div className="table-row">
        {keyLabel}
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
      {keyLabel}
      <input value={displayValue} onChange={(event) => onEdit(event.target.value)} />
      <button className="ghost-button" onClick={() => onPreview(displayValue)}>
        Preview
      </button>
    </div>
  );
}
