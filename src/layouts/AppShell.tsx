import { Outlet, useLocation } from "react-router-dom";
import { useAppState } from "../store/appStore";
import PreviewModal from "../components/PreviewModal";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

type PageMeta = {
  title: string;
  subtitle: string;
};

const DEFAULT_META: PageMeta = {
  title: "Codex Manager",
  subtitle: ""
};

function pageMeta(pathname: string): PageMeta {
  if (pathname === "/") {
    return {
      title: "Dashboard",
      subtitle: "A live snapshot of trust, safety, and scope."
    };
  }
  if (pathname.startsWith("/config/library")) {
    return {
      title: "Public Config Library",
      subtitle: "Browse and apply trusted public config presets."
    };
  }
  if (pathname.startsWith("/config/my")) {
    return {
      title: "My Configs",
      subtitle: "Create, store, and apply your own config presets."
    };
  }
  if (pathname.startsWith("/config")) {
    return {
      title: "Config",
      subtitle: "Inspect and edit Codex config with guarded diffs."
    };
  }
  if (pathname.startsWith("/mcp")) {
    return {
      title: "MCP Servers",
      subtitle: "Toggle servers and author new MCP entries."
    };
  }
  if (pathname.startsWith("/skills")) {
    return {
      title: "Skills",
      subtitle: "Edit SKILL.md assets across precedence layers."
    };
  }
  if (pathname.startsWith("/backups")) {
    return {
      title: "Backups",
      subtitle: "Restore from atomic backup manifests."
    };
  }
  if (pathname.startsWith("/settings")) {
    return {
      title: "Settings",
      subtitle: "Control paths and repo scopes."
    };
  }
  return DEFAULT_META;
}

export default function AppShell() {
  const location = useLocation();
  const { error } = useAppState();
  const meta = pageMeta(location.pathname);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        {error ? <div className="banner error">{error}</div> : null}
        <Outlet />
      </main>
      <PreviewModal />
    </div>
  );
}
