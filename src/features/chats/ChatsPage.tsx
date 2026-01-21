import { useCallback, useEffect, useMemo, useState } from "react";
import { chatSessionsList } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type { ChatSessionSummary, ChatSessionsResponse } from "../../lib/types";

type LoadState = {
  data: ChatSessionsResponse | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_STATE = {
  data: null,
  loading: true,
  error: null
};

function formatDateTime(ts?: number | null) {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleString();
}

function formatRelative(ts?: number | null) {
  if (!ts) return "Unknown";
  const delta = Date.now() - ts * 1000;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ChatsPage() {
  const [state, setState] = useState<LoadState>(EMPTY_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await chatSessionsList();
      setState({ data, loading: false, error: null });
      if (!selectedId && data.sessions.length > 0) {
        setSelectedId(data.sessions[0].id);
      }
    } catch (err) {
      setState({ data: null, loading: false, error: normalizeError(err) });
    }
  }, [selectedId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const handleFocus = () => {
      void loadSessions();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSessions]);

  const sessions = useMemo(() => {
    const list = state.data?.sessions ? [...state.data.sessions] : [];
    list.sort((a, b) => (b.last_ts ?? 0) - (a.last_ts ?? 0));
    return list;
  }, [state.data]);
  const selected = useMemo<ChatSessionSummary | null>(() => {
    if (!selectedId) return null;
    return sessions.find((session) => session.id === selectedId) ?? null;
  }, [selectedId, sessions]);

  const sessionsPath = state.data?.sessions_path ?? "CODEX_HOME/sessions";

  return (
    <div className="split chat-layout">
      <section className="panel panel-scroll">
        <div className="panel-header">
          <div>
            <h2>Sessions</h2>
            <p className="panel-meta">Scanning {sessionsPath}</p>
          </div>
          <div className="row-actions">
            <button
              className="ghost-button small"
              type="button"
              onClick={() => void loadSessions()}
              disabled={state.loading}
            >
              Refresh
            </button>
            <span className="badge info">
              {state.loading ? "Scanning" : `${sessions.length} found`}
            </span>
          </div>
        </div>
        <div className="panel-body scroll chat-list-scroll">
          {state.error ? (
            <div className="banner error">{state.error}</div>
          ) : null}
          {state.data && state.data.parse_errors > 0 ? (
            <div className="warnings">
              {state.data.parse_errors} session log entries could not be parsed.
              They were skipped during indexing.
            </div>
          ) : null}
          {!state.loading && state.data && !state.data.sessions_dir_exists ? (
            <p className="ghost">
              Sessions directory not found. Set CODEX_HOME in Settings to scan
              local Codex history.
            </p>
          ) : null}
          {!state.loading &&
          state.data &&
          state.data.sessions_dir_exists &&
          sessions.length === 0 ? (
            <p className="ghost">
              No sessions yet. Start a chat in Codex and it will appear here.
            </p>
          ) : null}
          {sessions.length > 0 ? (
            <ul className="list chat-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={`list-item ${selectedId === session.id ? "active" : ""}`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <div className="list-row">
                      <div className="row-body">
                        <p className="row-title">Session {session.id}</p>
                        <p className="row-meta">
                          {session.last_cwd ?? "Unknown workspace"}
                          {session.last_model ? ` · ${session.last_model}` : ""}
                        </p>
                      </div>
                      <div className="row-actions">
                        <span className="pill">{formatRelative(session.last_ts)}</span>
                      </div>
                    </div>
                    <p className="list-path">{session.last_cwd ?? "No workspace recorded"}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="panel panel-scroll">
        <div className="panel-header">
          <div>
            <h2>Transcript</h2>
            <p className="panel-meta">Read-only session view (Phase 0)</p>
          </div>
          {selected ? (
            <span className="badge info">{selected.message_count} messages</span>
          ) : null}
        </div>
        <div className="panel-body scroll">
          {!selected ? (
            <p className="ghost">Select a session to view details.</p>
          ) : (
            <div className="chat-detail">
              <div className="row">
                <div className="row-body">
                  <p className="row-title">Session id</p>
                  <p className="row-meta">{selected.id}</p>
                </div>
              </div>
              <div className="row">
                <div className="row-body">
                  <p className="row-title">Workspace</p>
                  <p className="row-meta">{selected.last_cwd ?? "Unknown"}</p>
                </div>
              </div>
              <div className="row">
                <div className="row-body">
                  <p className="row-title">Model</p>
                  <p className="row-meta">{selected.last_model ?? "Unknown"}</p>
                </div>
              </div>
              <div className="row">
                <div className="row-body">
                  <p className="row-title">First seen</p>
                  <p className="row-meta">{formatDateTime(selected.first_ts)}</p>
                </div>
              </div>
              <div className="row">
                <div className="row-body">
                  <p className="row-title">Last activity</p>
                  <p className="row-meta">{formatDateTime(selected.last_ts)}</p>
                </div>
              </div>
              <p className="ghost">
                Transcript rendering and lazy loading ship in Phase 1.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
