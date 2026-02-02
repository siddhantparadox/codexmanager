import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./layouts/AppShell";
import BackupsPage from "./features/backups/BackupsPage";
import ChatsPage from "./features/chats/ChatsPage";
import ConfigLibraryPage from "./features/config/ConfigLibraryPage";
import ConfigPage from "./features/config/ConfigPage";
import MyConfigsPage from "./features/config/MyConfigsPage";
import DashboardPage from "./features/dashboard/DashboardPage";
import McpPage from "./features/mcp/McpPage";
import SettingsPage from "./features/settings/SettingsPage";
import PublicSkillsPage from "./features/skills/PublicSkillsPage";
import SkillsPage from "./features/skills/SkillsPage";
import { AppProvider } from "./store/appStore";

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="chats" element={<ChatsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="config/library" element={<ConfigLibraryPage />} />
            <Route path="config/my" element={<MyConfigsPage />} />
            <Route path="mcp" element={<McpPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="skills/public" element={<PublicSkillsPage />} />
            <Route path="backups" element={<BackupsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
