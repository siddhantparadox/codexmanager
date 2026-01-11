import { useAppState } from "../store/appStore";

export default function PreviewModal() {
  const { preview, applyPending, closePreview } = useAppState();

  if (!preview) return null;

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
        <pre className="diff">{preview.diff || "No changes."}</pre>
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
