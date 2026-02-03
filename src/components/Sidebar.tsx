import { NavLink, useLocation } from "react-router-dom";
import { useAppState } from "../store/appStore";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/" },
  { label: "Chats", to: "/chats" },
  { label: "Config", to: "/config" },
  { label: "MCP Servers", to: "/mcp" },
  { label: "Skills", to: "/skills" },
  { label: "Backups", to: "/backups" },
  { label: "Settings", to: "/settings" }
];

export default function Sidebar() {
  const location = useLocation();
  const { scan, busy, refresh } = useAppState();
  const configActive =
    location.pathname === "/config" || location.pathname.startsWith("/config/");
  const skillsActive =
    location.pathname === "/skills" || location.pathname.startsWith("/skills/");

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src="/logo.svg" alt="Codex Manager logo" className="brand-logo" />
        </div>
        <div>
          <p className="brand-title">Codex Manager</p>
          <p className="brand-subtitle">Trust-first configuration desk</p>
        </div>
      </div>
      <nav className="nav">
        {NAV_ITEMS.map((item) => {
          const isConfig = item.to === "/config";
          const isSkills = item.to === "/skills";
          const className = isConfig
            ? `nav-item ${configActive ? "active" : ""}`
            : isSkills
              ? `nav-item ${skillsActive ? "active" : ""}`
              : "nav-item";
          return (
            <div key={item.to} className="nav-group">
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  isConfig || isSkills
                    ? className
                    : `nav-item ${isActive ? "active" : ""}`
                }
              >
                {item.label}
              </NavLink>
              {isConfig && configActive ? (
                <div className="subnav">
                  <NavLink
                    to="/config/library"
                    className={({ isActive }) =>
                      `subnav-item ${isActive ? "active" : ""}`
                    }
                  >
                    Public Config Library
                  </NavLink>
                  <NavLink
                    to="/config/my"
                    className={({ isActive }) =>
                      `subnav-item ${isActive ? "active" : ""}`
                    }
                  >
                    My Configs
                  </NavLink>
                </div>
              ) : null}
              {isSkills && skillsActive ? (
                <div className="subnav">
                  <NavLink
                    to="/skills/public"
                    className={({ isActive }) =>
                      `subnav-item ${isActive ? "active" : ""}`
                    }
                  >
                    Public Skills
                  </NavLink>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <p className="foot-label">Codex home</p>
        <p className="foot-value">{scan?.settings.codex_home || "Not set"}</p>
        <button
          className="ghost-button"
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh scan
        </button>
      </div>
    </aside>
  );
}
