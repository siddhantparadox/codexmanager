import { PatchDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useAppState } from "../store/appStore";

export default function PreviewModal() {
  const { preview, applyPending, closePreview } = useAppState();

  if (!preview) return null;

  const patch = preview.diff;
  const hasDiff = patch.trim().length > 0;
  const diffOptions = useMemo(
    () => ({
      diffStyle: "unified" as const,
      themeType: "light" as const
    }),
    []
  );

  return (
    <div className="modal">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Preview: {preview.operation}</h2>
          <button className="ghost-button" onClick={closePreview}>
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
        {hasDiff ? (
          <div className="diff-view" role="region" aria-label="Diff preview">
            <PatchDiff patch={patch} options={diffOptions} />
          </div>
        ) : (
          <div className="diff-empty">No changes.</div>
        )}
        <div className="modal-actions">
          <button className="ghost-button" onClick={closePreview}>
            Cancel
          </button>
          <button className="primary" onClick={() => void applyPending()}>
            Apply change
          </button>
        </div>
      </div>
    </div>
  );
}
