import { deleteAllBackups, deleteBackup } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import { useAppState } from "../../store/appStore";

export default function BackupsPage() {
  const { scan, reloadBackups, openPreview, setBusy, setError, setNotice } = useAppState();
  const hasBackups = Boolean(scan?.backups.length);

  async function handleDeleteBackup(id: string) {
    if (!window.confirm("Delete this backup? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteBackup(id);
      setNotice("Backup deleted.");
      await reloadBackups();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm("Delete all backups? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAllBackups();
      setNotice("All backups deleted.");
      await reloadBackups();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-header">
          <h2>Backups</h2>
          <div className="panel-actions">
            <button
              className="ghost-button"
              onClick={() => void handleDeleteAll()}
              disabled={!hasBackups}
            >
              Delete all
            </button>
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
                  <button
                    className="ghost-button"
                    onClick={() => void handleDeleteBackup(backup.id)}
                  >
                    Delete
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
