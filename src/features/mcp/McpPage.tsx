import { useState } from "react";
import { useAppState } from "../../store/appStore";

const DEFAULT_MCP_TABLE = "enabled = true\n";

export default function McpPage() {
  const { scan, openPreview } = useAppState();
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpTable, setNewMcpTable] = useState(DEFAULT_MCP_TABLE);

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-header">
          <h2>MCP servers</h2>
          <span className="panel-meta">Toggle enabled flags only</span>
        </div>
        {!scan?.config.exists ? (
          <p className="ghost">No config.toml found.</p>
        ) : (
          <div className="list">
            {scan?.config.mcp_servers.map((server) => (
              <div key={server.name} className="row">
                <div>
                  <p className="row-title">{server.name}</p>
                  <p className="row-meta">{server.transport || "unknown transport"}</p>
                </div>
                <div className="row-actions">
                  <span className={`badge ${server.enabled ? "good" : "warn"}`}>
                    {server.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      void openPreview({
                        type: "toggle_mcp_server",
                        name: server.name,
                        enabled: !server.enabled
                      })
                    }
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Add MCP server</h2>
          <span className="panel-meta">Paste table body TOML</span>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              value={newMcpName}
              onChange={(event) => setNewMcpName(event.target.value)}
              placeholder="server-name"
            />
          </label>
          <label className="span-2">
            Table body (TOML)
            <textarea
              value={newMcpTable}
              onChange={(event) => setNewMcpTable(event.target.value)}
              placeholder={'enabled = true\ntransport = "stdio"\ncommand = "python"'}
            />
          </label>
        </div>
        <div className="panel-actions">
          <button
            className="primary"
            onClick={() =>
              void openPreview({
                type: "upsert_mcp_server",
                name: newMcpName,
                table_toml: newMcpTable
              })
            }
            disabled={!newMcpName.trim()}
          >
            Preview add/update
          </button>
        </div>
      </div>
    </section>
  );
}
