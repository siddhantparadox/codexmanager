import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../store/appStore";

export default function DashboardPage() {
  const { scan, busy, loadConfig } = useAppState();
  const navigate = useNavigate();

  const dashboardStats = useMemo(() => {
    if (!scan) return null;
    return {
      mcpTotal: scan.config.mcp_servers.length,
      mcpDisabled: scan.config.mcp_servers.filter((mcp) => !mcp.enabled).length,
      skills: scan.skills.length,
      backups: scan.backups.length
    };
  }, [scan]);

  const diagnostics = scan?.diagnostics ?? [];

  return (
    <section className="grid">
      <div className="card" style={cardDelay("0ms")}>
        <h3>Config status</h3>
        <p className="card-value">{scan?.config.exists ? "Detected" : "Missing"}</p>
        {scan?.config.parse_error ? (
          <p className="card-warning">Parse error in config.toml</p>
        ) : (
          <p className="card-note">Round-trip safe editing enabled.</p>
        )}
        <button
          className="ghost-button"
          onClick={async () => {
            const ok = await loadConfig();
            if (ok) {
              navigate("/config");
            }
          }}
          disabled={busy}
        >
          Load config
        </button>
      </div>
      <div className="card" style={cardDelay("80ms")}>
        <h3>MCP servers</h3>
        <p className="card-value">{dashboardStats?.mcpTotal ?? "-"}</p>
        <p className="card-note">
          {dashboardStats ? `${dashboardStats.mcpDisabled} disabled` : "Awaiting scan"}
        </p>
        <button className="ghost-button" onClick={() => navigate("/mcp")}>
          See MCP
        </button>
      </div>
      <div className="card" style={cardDelay("160ms")}>
        <h3>Skills</h3>
        <p className="card-value">{dashboardStats?.skills ?? "-"}</p>
        <p className="card-note">User + repo scopes</p>
        <button className="ghost-button" onClick={() => navigate("/skills")}>
          Manage skills
        </button>
      </div>
      <div className="card" style={cardDelay("240ms")}>
        <h3>Backups</h3>
        <p className="card-value">{dashboardStats?.backups ?? "-"}</p>
        <p className="card-note">Automatic safety snapshots</p>
        <button className="ghost-button" onClick={() => navigate("/backups")}>
          View backups
        </button>
      </div>
      <div className="panel wide">
        <div className="panel-header">
          <h2>Diagnostics</h2>
          <span className="panel-meta">{diagnostics.length} alerts</span>
        </div>
        {diagnostics.length === 0 ? (
          <p className="ghost">No issues detected.</p>
        ) : (
          <ul className="list">
            {diagnostics.map((item, idx) => (
              <li key={`${item.message}-${idx}`}>
                <span className={`badge ${item.level}`}>{item.level.toUpperCase()}</span>
                <span className="list-text">{item.message}</span>
                {item.path ? <span className="list-path">{item.path}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function cardDelay(delay: string): CSSProperties {
  return { "--delay": delay } as CSSProperties;
}
