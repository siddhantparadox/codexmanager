import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { JsonValue, ScalarValue } from "../../../lib/types";

type ConfigTreeProps = {
  value: JsonValue;
  filter?: string;
  onPreview?: (path: string[], value: ScalarValue) => void;
};

type DraftValue = string | boolean;

export default function ConfigTree({ value, filter, onPreview }: ConfigTreeProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const filterValue = useMemo(() => filter?.trim().toLowerCase() ?? "", [filter]);

  if (!isPlainObject(value)) {
    return <p className="ghost">No structured data to display.</p>;
  }

  const entries = renderEntries(value, [], 0, filterValue, drafts, setDrafts, onPreview);
  if (!entries.length) {
    return <p className="ghost">No matching keys.</p>;
  }
  return <div className="config-tree">{entries}</div>;
}

function renderEntries(
  value: Record<string, JsonValue>,
  path: string[],
  depth: number,
  filterValue: string,
  drafts: Record<string, DraftValue>,
  setDrafts: Dispatch<SetStateAction<Record<string, DraftValue>>>,
  onPreview?: (path: string[], value: ScalarValue) => void
) {
  return Object.entries(value)
    .filter(([key, entry]) =>
      shouldShowNode(key, entry, path, filterValue)
    )
    .map(([key, entry]) => (
      <ConfigNode
        key={`${depth}-${key}`}
        name={key}
        value={entry}
        depth={depth}
        path={[...path, key]}
        filterValue={filterValue}
        drafts={drafts}
        setDrafts={setDrafts}
        onPreview={onPreview}
      />
    ));
}

function ConfigNode({
  name,
  value,
  depth,
  path,
  filterValue,
  drafts,
  setDrafts,
  onPreview
}: {
  name: string;
  value: JsonValue;
  depth: number;
  path: string[];
  filterValue: string;
  drafts: Record<string, DraftValue>;
  setDrafts: Dispatch<SetStateAction<Record<string, DraftValue>>>;
  onPreview?: (path: string[], value: ScalarValue) => void;
}) {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    return (
      <details className="config-node" open={Boolean(filterValue) || depth < 1}>
        <summary className="config-row">
          <span className="config-key">{name}</span>
          <span className="config-type">{entries.length} keys</span>
        </summary>
        {entries.length ? (
          <div className="config-children">
            {renderEntries(
              value,
              path,
              depth + 1,
              filterValue,
              drafts,
              setDrafts,
              onPreview
            )}
          </div>
        ) : (
          <p className="config-empty">Empty table</p>
        )}
      </details>
    );
  }

  if (Array.isArray(value)) {
    const isPrimitiveArray = value.every(isPrimitive);
    return (
      <div className="config-node">
        <div className="config-row">
          <span className="config-key">{name}</span>
          <span className="config-type">array · {value.length}</span>
        </div>
        {value.length === 0 ? (
          <p className="config-empty">Empty array</p>
        ) : isPrimitiveArray ? (
          <div className="config-chips">
            {value.map((item, index) => (
              <span className="config-chip" key={`${name}-${index}`}>
                {formatValue(item)}
              </span>
            ))}
          </div>
        ) : (
          <div className="config-children">
            {value.map((item, index) => (
              <ConfigNode
                key={`${name}-${index}`}
                name={`[${index}]`}
                value={item}
                depth={depth + 1}
                path={[...path, `[${index}]`]}
                filterValue={filterValue}
                drafts={drafts}
                setDrafts={setDrafts}
                onPreview={onPreview}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const pathKey = JSON.stringify(path);
  const isBooleanValue = typeof value === "boolean";
  const isNumberValue = typeof value === "number";
  const isStringValue = typeof value === "string";
  const draftValue = drafts[pathKey];
  const displayValue =
    typeof draftValue === "string" || typeof draftValue === "boolean"
      ? draftValue
      : value;

  const parsedValue = buildScalarValue(value, displayValue);
  const isValid = parsedValue !== null;
  const isChanged = isValueChanged(value, displayValue);

  return (
    <div className="config-node">
      <div className="config-row">
        <span className="config-key">{name}</span>
        <div className="config-actions">
          {isBooleanValue ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(displayValue)}
                onChange={(event) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [pathKey]: event.target.checked
                  }))
                }
              />
              <span className="slider"></span>
            </label>
          ) : (
            <input
              className="config-input"
              value={String(displayValue)}
              onChange={(event) =>
                setDrafts((prev) => ({
                  ...prev,
                  [pathKey]: event.target.value
                }))
              }
            />
          )}
          <span className="config-type">
            {isStringValue ? "string" : isNumberValue ? "number" : "boolean"}
          </span>
          {onPreview ? (
            <button
              className="ghost-button small"
              disabled={!isValid || !isChanged}
              onClick={() => {
                if (!parsedValue) {
                  return;
                }
                onPreview(path, parsedValue);
              }}
            >
              Preview
            </button>
          ) : null}
        </div>
      </div>
      {!isValid ? <p className="config-error">Invalid value.</p> : null}
    </div>
  );
}

function isPlainObject(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: JsonValue): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatValue(value: JsonValue) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
}

function shouldShowNode(
  key: string,
  value: JsonValue,
  path: string[],
  filterValue: string
) {
  if (!filterValue) {
    return true;
  }
  const label = [...path, key].join(".").toLowerCase();
  if (label.includes(filterValue)) {
    return true;
  }
  if (isPlainObject(value)) {
    return Object.entries(value).some(([childKey, childValue]) =>
      shouldShowNode(childKey, childValue, [...path, key], filterValue)
    );
  }
  if (Array.isArray(value)) {
    return value.some((childValue, index) =>
      shouldShowNode(`[${index}]`, childValue, [...path, key], filterValue)
    );
  }
  return false;
}

function buildScalarValue(
  current: JsonValue,
  raw: DraftValue | JsonValue
): ScalarValue | null {
  if (typeof current === "boolean") {
    return { kind: "boolean", value: Boolean(raw) };
  }
  if (typeof current === "number") {
    if (typeof raw !== "string") {
      const value = Number(raw);
      if (Number.isNaN(value)) return null;
      return Number.isInteger(value)
        ? { kind: "integer", value }
        : { kind: "float", value };
    }
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    return Number.isInteger(value)
      ? { kind: "integer", value }
      : { kind: "float", value };
  }
  if (typeof current === "string") {
    return { kind: "string", value: String(raw) };
  }
  return null;
}

function isValueChanged(current: JsonValue, raw: DraftValue | JsonValue) {
  if (typeof current === "boolean") {
    return Boolean(raw) !== current;
  }
  if (typeof current === "number") {
    const value = Number(raw);
    if (Number.isNaN(value)) return false;
    return value !== current;
  }
  if (typeof current === "string") {
    return String(raw) !== current;
  }
  return false;
}
