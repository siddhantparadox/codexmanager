import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatOverlaySet,
  chatSessionLatest,
  chatSessionPage,
  chatSessionsList
} from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type {
  ChatMessage,
  ChatMessagesPage,
  ChatSessionSummary,
  ChatSessionsResponse
} from "../../lib/types";

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

const MESSAGE_PAGE_SIZE = 100;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "pinned", label: "Pinned" },
  { id: "archived", label: "Archived" }
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

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

function formatSessionLabel(sessionId: string) {
  const match =
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/.exec(sessionId);
  if (match?.[1]) {
    return match[1];
  }
  return sessionId;
}

type ContentBlock =
  | { type: "text"; value: string }
  | { type: "code"; value: string; lang?: string };

function parseContentBlocks(content: string): ContentBlock[] {
  if (!content.includes("```")) {
    return content ? [{ type: "text", value: content }] : [];
  }
  const blocks: ContentBlock[] = [];
  const regex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        blocks.push({ type: "text", value: text });
      }
    }
    blocks.push({ type: "code", value: match[2], lang: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    const tail = content.slice(lastIndex);
    if (tail.trim()) {
      blocks.push({ type: "text", value: tail });
    }
  }
  return blocks;
}

function formatMessageTime(ts?: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString();
}

function formatRoleLabel(role: string) {
  const normalized = role.toLowerCase();
  if (normalized.includes("user")) return "You";
  if (normalized.includes("assistant")) return "Codex";
  if (normalized.includes("tool")) return "Tool";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function ChatsPage() {
  const [state, setState] = useState<LoadState>(EMPTY_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState<FilterId>("all");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<number | null>(null);
  const [messagesTotal, setMessagesTotal] = useState<number | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await chatSessionsList();
      setState({ data, loading: false, error: null });
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
    const search = query.trim().toLowerCase();
    let filtered = list;
    if (search) {
      filtered = list.filter((session) => {
        const fields = [session.id, session.last_cwd ?? "", session.last_model ?? ""]
          .join(" ")
          .toLowerCase();
        return fields.includes(search);
      });
    }
    if (filterId === "pinned") {
      filtered = filtered.filter((session) => session.pinned);
    } else if (filterId === "archived") {
      filtered = filtered.filter((session) => session.archived);
    }
    return filtered;
  }, [state.data, query, filterId]);

  const selected = useMemo<ChatSessionSummary | null>(() => {
    if (!selectedId) return null;
    return sessions.find((session) => session.id === selectedId) ?? null;
  }, [selectedId, sessions]);

  const sessionsPath = state.data?.sessions_path ?? "CODEX_HOME/sessions";

  const loadLatestMessages = useCallback(async (sessionId: string) => {
    setMessages([]);
    setMessagesCursor(null);
    setMessagesTotal(null);
    setMessagesError(null);
    setMessagesLoading(true);
    try {
      const page = await chatSessionLatest(sessionId, MESSAGE_PAGE_SIZE);
      setMessages(page.messages);
      setMessagesCursor(page.next_cursor ?? null);
      setMessagesTotal(page.total_count);
    } catch (err) {
      setMessagesError(normalizeError(err));
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const copySessionId = useCallback(() => {
    if (!selected) return;
    const id = formatSessionLabel(selected.id);
    void navigator.clipboard.writeText(id).then(() => {
      setCopyNotice("Copied");
      window.setTimeout(() => setCopyNotice(null), 1500);
    });
  }, [selected]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedId || messagesCursor === null || loadingOlder) return;
    const container = scrollRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page: ChatMessagesPage = await chatSessionPage(
        selectedId,
        messagesCursor,
        MESSAGE_PAGE_SIZE
      );
      setMessages((prev) => [...page.messages, ...prev]);
      setMessagesCursor(page.next_cursor ?? null);
      setMessagesTotal(page.total_count);
      requestAnimationFrame(() => {
        const nextContainer = scrollRef.current;
        if (nextContainer) {
          const nextHeight = nextContainer.scrollHeight;
          nextContainer.scrollTop += nextHeight - prevHeight;
        }
      });
    } catch (err) {
      setMessagesError(normalizeError(err));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messagesCursor, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesCursor(null);
      setMessagesTotal(null);
      return;
    }
    void loadLatestMessages(selectedId);
  }, [loadLatestMessages, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const now = Math.floor(Date.now() / 1000);
    setState((prev) => {
      if (!prev.data) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          sessions: prev.data.sessions.map((session) =>
            session.id === selectedId
              ? { ...session, last_read_ts: now, has_unread: false }
              : session
          )
        }
      };
    });
    void chatOverlaySet(selectedId, { lastReadTs: now }).catch(() => null);
  }, [selectedId, messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setShowJump(!nearBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [selectedId, messages.length]);

  return (
    <div className="split chat-layout">
      <section className="panel panel-scroll chat-panel">
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
        <div className="panel-tools">
          <div className="filter-bar chat-filter-bar">
            <input
              type="search"
              placeholder="Search sessions, workspaces, models"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="chat-filter-chips">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`filter-chip ${filterId === filter.id ? "active" : ""}`}
                  onClick={() => setFilterId(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          {filterId !== "all" ? (
            <p className="panel-note">
              Filters use local overlay data (pinned/archived).
            </p>
          ) : null}
        </div>
        <div className="panel-body scroll chat-list-scroll">
          {state.error ? <div className="banner error">{state.error}</div> : null}
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
                    title={session.id}
                  >
                    <div className="list-row">
                      <div className="row-body">
                        <p className="row-title">
                          {session.title?.trim()
                            ? session.title
                            : `Session ${formatSessionLabel(session.id)}`}
                        </p>
                        <p className="row-meta">
                          {session.last_cwd ?? "Workspace not recorded"}
                          {session.last_model ? ` · ${session.last_model}` : ""}
                        </p>
                      </div>
                      <div className="row-actions">
                        {session.pinned ? <span className="pill">Pinned</span> : null}
                        {session.archived ? <span className="pill">Archived</span> : null}
                        <span className="pill">{formatRelative(session.last_ts)}</span>
                      </div>
                    </div>
                    {session.last_cwd ? (
                      <p className="list-path">{session.last_cwd}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="panel panel-scroll chat-panel">
        <div className="panel-header">
          <div>
            <h2>Transcript</h2>
            <p className="panel-meta">Latest turns with lazy loading</p>
          </div>
          {selected ? (
            <span className="badge info">
              {messagesTotal ?? messages.length} messages
            </span>
          ) : null}
        </div>
        <div className="panel-body">
          {!selected ? (
            <div className="chat-detail-empty">
              <p className="ghost">Select a session to view details.</p>
            </div>
          ) : (
            <div className="chat-detail">
              <div className="chat-detail-sticky">
                <div className="chat-detail-actions">
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => {
                      if (!selected) return;
                      setOverlayBusy(true);
                      void chatOverlaySet(selected.id, { pinned: !selected.pinned })
                        .then(() => void loadSessions())
                        .finally(() => setOverlayBusy(false));
                    }}
                    disabled={overlayBusy || !selected}
                  >
                    {selected?.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => {
                      if (!selected) return;
                      setOverlayBusy(true);
                      void chatOverlaySet(selected.id, { archived: !selected.archived })
                        .then(() => void loadSessions())
                        .finally(() => setOverlayBusy(false));
                    }}
                    disabled={overlayBusy || !selected}
                  >
                    {selected?.archived ? "Unarchive" : "Archive"}
                  </button>
                </div>
                <div className="chat-detail-meta">
                  <div>
                    <p className="row-title">Session id</p>
                    <div className="session-id-line">
                      <p className="row-meta">{formatSessionLabel(selected.id)}</p>
                      <button
                        type="button"
                        className="ghost-button tiny"
                        onClick={copySessionId}
                      >
                        Copy full ID
                      </button>
                      {copyNotice ? <span className="pill">{copyNotice}</span> : null}
                    </div>
                  </div>
                  <div>
                    <p className="row-title">Workspace</p>
                    <p className="row-meta">{selected.last_cwd ?? "Unknown"}</p>
                  </div>
                  <div>
                    <p className="row-title">Model</p>
                    <p className="row-meta">{selected.last_model ?? "Unknown"}</p>
                  </div>
                  <div>
                    <p className="row-title">First seen</p>
                    <p className="row-meta">{formatDateTime(selected.first_ts)}</p>
                  </div>
                  <div>
                    <p className="row-title">Last activity</p>
                    <p className="row-meta">{formatDateTime(selected.last_ts)}</p>
                  </div>
                </div>
              </div>
              <div className="chat-transcript-scroll" ref={scrollRef}>
                {messagesCursor !== null ? (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void loadOlderMessages()}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? "Loading..." : "Load older"}
                  </button>
                ) : null}
                {messagesTotal !== null && messagesTotal > messages.length ? (
                  <p className="panel-note">
                    Showing latest {messages.length} of {messagesTotal} messages.
                  </p>
                ) : null}
                {messagesLoading ? <p className="ghost">Loading transcript...</p> : null}
                {messagesError ? <div className="banner error">{messagesError}</div> : null}
                <div className="chat-messages">
                  {messages.length === 0 && !messagesLoading ? (
                    <p className="ghost">No messages yet.</p>
                  ) : null}
                  {messages.map((message) => {
                    const blocks = parseContentBlocks(message.content);
                    const role = message.role.toLowerCase();
                    return (
                      <div key={message.id} className={`chat-message role-${role}`}>
                        <div className="chat-bubble">
                          <div className="chat-message-header">
                            <span className="chat-message-role">
                              {formatRoleLabel(message.role)}
                            </span>
                            <span className="chat-message-meta">
                              {formatMessageTime(message.timestamp)}
                            </span>
                          </div>
                          <div className="chat-message-body">
                            {blocks.length === 0 ? (
                              <p className="chat-message-content">{message.content}</p>
                            ) : (
                              blocks.map((block, index) =>
                                block.type === "code" ? (
                                  <div
                                    key={`${message.id}-code-${index}`}
                                    className="chat-code-block"
                                  >
                                    <div className="chat-code-header">
                                      <span>{block.lang ?? "code"}</span>
                                      <button
                                        type="button"
                                        className="ghost-button small"
                                        onClick={() =>
                                          void navigator.clipboard.writeText(block.value)
                                        }
                                      >
                                        Copy
                                      </button>
                                    </div>
                                    <pre className="chat-code-content">{block.value}</pre>
                                  </div>
                                ) : (
                                  <p
                                    key={`${message.id}-text-${index}`}
                                    className="chat-message-content"
                                  >
                                    {block.value}
                                  </p>
                                )
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {showJump ? (
                  <button
                    type="button"
                    className="primary chat-jump"
                    onClick={() => {
                      const el = scrollRef.current;
                      if (el) {
                        el.scrollTop = el.scrollHeight;
                      }
                    }}
                  >
                    Jump to latest
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
