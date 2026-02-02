import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { chatSessionsList } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import { useAppState } from "../../store/appStore";

export default function DashboardPage() {
  const { scan, busy, loadConfig } = useAppState();
  const navigate = useNavigate();
  const [chatCount, setChatCount] = useState<number | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const loadChats = async () => {
      setChatLoading(true);
      setChatError(null);
      try {
        const result = await chatSessionsList();
        if (!active) return;
        setChatCount(result.sessions.length);
      } catch (err) {
        if (!active) return;
        setChatCount(null);
        setChatError(normalizeError(err));
      } finally {
        if (active) {
          setChatLoading(false);
        }
      }
    };
    void loadChats();
    return () => {
      active = false;
    };
  }, [scan]);

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
        <h3>Chats</h3>
        <p className="card-value">{chatCount ?? "-"}</p>
        <p className="card-note">
          {chatError
            ? "Unable to load sessions"
            : chatLoading
              ? "Loading sessions"
              : "Local session history"}
        </p>
        <button className="ghost-button" onClick={() => navigate("/chats")}>
          Open chats
        </button>
      </div>
      <div className="card" style={cardDelay("320ms")}>
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
