import { useAppState } from "../../store/appStore";

export default function BackupsPage() {
  const { scan, reloadBackups, openPreview } = useAppState();

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-header">
          <h2>Backups</h2>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => reloadBackups()}>
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
                      void openPreview({
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
  );
}
