import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatOverlaySet,
  chatSessionLatest,
  chatSessionPage,
  chatSessionsList,
  codexBuildCommand,
  codexRunCommand,
  workspacesList,
  workspacesUpsert
} from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type {
  CodexCommandPreview,
  CodexCommandRequest,
  CodexCommandResult,
  CodexRunOptions,
  ChatMessage,
  ChatMessagesPage,
  ChatSessionSummary,
  ChatSessionsResponse,
  WorkspaceEntry
} from "../../lib/types";
import ChatMarkdown from "../../components/ChatMarkdown";
import ThinkingBlock from "../../components/ThinkingBlock";
import ToolCallCard from "../../components/ToolCallCard";
import TranscriptMetaRow from "../../components/TranscriptMetaRow";

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

function normalizeKind(message: ChatMessage) {
  return (message.kind ?? message.role ?? "meta").toLowerCase();
}

function isBubbleKind(kind: string) {
  return kind === "user" || kind === "assistant";
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
  const [showMeta, setShowMeta] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [workspaceChoice, setWorkspaceChoice] = useState("custom");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceProfile, setWorkspaceProfile] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formSandbox, setFormSandbox] = useState("workspace-write");
  const [formApprovals, setFormApprovals] = useState("on-request");
  const [formSearch, setFormSearch] = useState(false);
  const [formPrompt, setFormPrompt] = useState("");
  const [commandPreview, setCommandPreview] = useState<CodexCommandPreview | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandResult, setCommandResult] = useState<CodexCommandResult | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoLoadRef = useRef(false);
  const stickToBottomRef = useRef(true);

  const loadSessions = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await chatSessionsList();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: normalizeError(err) });
    }
  }, [selectedId]);

  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await workspacesList();
      setWorkspaces(list);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

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

  const visibleMessages = useMemo(() => {
    if (showMeta) {
      return messages;
    }
    return messages.filter((message) => normalizeKind(message) !== "meta");
  }, [messages, showMeta]);

  const sessionsPath = state.data?.sessions_path ?? "CODEX_HOME/sessions";

  const buildResumeRequest = useCallback(
    (session: ChatSessionSummary): CodexCommandRequest => ({
      kind: "resume",
      session_id: session.id,
      options: {
        cwd: session.last_cwd ?? undefined,
        model: session.last_model ?? undefined
      }
    }),
    []
  );

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

  const copyResumeCommand = useCallback(async () => {
    if (!selected) return;
    setResumeError(null);
    setResumeNotice(null);
    try {
      const preview = await codexBuildCommand(buildResumeRequest(selected));
      await navigator.clipboard.writeText(preview.display);
      setResumeNotice("Resume command copied.");
      window.setTimeout(() => setResumeNotice(null), 2000);
    } catch (err) {
      setResumeError(normalizeError(err));
    }
  }, [buildResumeRequest, selected]);

  const openResumeInCli = useCallback(async () => {
    if (!selected) return;
    setResumeError(null);
    setResumeNotice(null);
    setResumeBusy(true);
    try {
      const result = await codexRunCommand(buildResumeRequest(selected), 20_000);
      if (result.timed_out) {
        setResumeError("Resume command timed out.");
      } else if (result.exit_code && result.exit_code !== 0) {
        setResumeError(result.stderr || "Resume command failed.");
      } else {
        setResumeNotice("Resume command finished.");
        window.setTimeout(() => setResumeNotice(null), 2000);
      }
    } catch (err) {
      setResumeError(normalizeError(err));
    } finally {
      setResumeBusy(false);
    }
  }, [buildResumeRequest, selected]);

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

  const applyWorkspaceSelection = useCallback(
    (id: string) => {
      if (id === "custom") {
        setWorkspaceChoice("custom");
        return;
      }
      const entry = workspaces.find((item) => item.id === id);
      if (!entry) {
        setWorkspaceChoice("custom");
        return;
      }
      setWorkspaceChoice(entry.id);
      setWorkspacePath(entry.path);
      setWorkspaceName(entry.name ?? "");
      setWorkspaceProfile(entry.default_profile ?? entry.last_run?.profile ?? "");
      setFormModel(entry.last_run?.model ?? "");
      setFormSandbox(entry.last_run?.sandbox ?? "workspace-write");
      setFormApprovals(entry.last_run?.approvals ?? "on-request");
      setFormSearch(entry.last_run?.search ?? false);
    },
    [workspaces]
  );

  const buildNewChatRequest = useCallback((): CodexCommandRequest => {
    const options: CodexRunOptions = {
      cwd: workspacePath || null,
      profile: workspaceProfile || null,
      model: formModel || null,
      sandbox: formSandbox || null,
      approvals: formApprovals || null,
      search: formSearch,
      prompt: formPrompt || null
    };
    return { kind: "new", options };
  }, [formApprovals, formModel, formPrompt, formSandbox, formSearch, workspacePath, workspaceProfile]);

  useEffect(() => {
    if (!newChatOpen) return;
    if (!workspacePath.trim()) {
      setCommandPreview(null);
      setCommandError("Workspace path is required.");
      return;
    }
    setCommandBusy(true);
    setCommandError(null);
    void codexBuildCommand(buildNewChatRequest())
      .then((preview) => setCommandPreview(preview))
      .catch((err) => setCommandError(normalizeError(err)))
      .finally(() => setCommandBusy(false));
  }, [buildNewChatRequest, newChatOpen, workspacePath]);

  const persistWorkspace = useCallback(async () => {
    if (!workspacePath.trim()) return;
    const entry: WorkspaceEntry = {
      id: workspacePath.trim(),
      name: workspaceName.trim() ? workspaceName.trim() : null,
      path: workspacePath.trim(),
      default_profile: workspaceProfile.trim() ? workspaceProfile.trim() : null,
      last_run: {
        cwd: workspacePath.trim(),
        profile: workspaceProfile.trim() ? workspaceProfile.trim() : null,
        model: formModel.trim() ? formModel.trim() : null,
        sandbox: formSandbox,
        approvals: formApprovals,
        search: formSearch,
        prompt: null
      }
    };
    const updated = await workspacesUpsert(entry);
    setWorkspaces(updated);
  }, [
    formApprovals,
    formModel,
    formSandbox,
    formSearch,
    workspaceName,
    workspacePath,
    workspaceProfile
  ]);

  const copyNewChatCommand = useCallback(async () => {
    const preview = await codexBuildCommand(buildNewChatRequest());
    await navigator.clipboard.writeText(preview.display);
    await persistWorkspace();
    setCommandPreview(preview);
  }, [buildNewChatRequest, persistWorkspace]);

  const runNewChatCommand = useCallback(async () => {
    setCommandError(null);
    setCommandResult(null);
    setCommandBusy(true);
    try {
      const result = await codexRunCommand(buildNewChatRequest(), 20_000);
      setCommandResult(result);
      await persistWorkspace();
    } catch (err) {
      setCommandError(normalizeError(err));
    } finally {
      setCommandBusy(false);
    }
  }, [buildNewChatRequest, persistWorkspace]);

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
      if (messagesCursor !== null && !loadingOlder) {
        if (el.scrollTop < 140 && !autoLoadRef.current) {
          autoLoadRef.current = true;
          void loadOlderMessages().finally(() => {
            autoLoadRef.current = false;
          });
        }
      }
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      stickToBottomRef.current = nearBottom;
      setShowJump(!nearBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [loadOlderMessages, loadingOlder, messagesCursor, messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (loadingOlder) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [loadingOlder, messages.length, selectedId]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedId]);

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
          <div className="panel-actions">
            <button
              type="button"
              className="ghost-button small"
              onClick={() => {
                setNewChatOpen(true);
                setCommandResult(null);
                setCommandError(null);
              }}
            >
              New chat
            </button>
            {selected ? (
              <span className="badge info">
                {messagesTotal ?? messages.length} messages
              </span>
            ) : null}
          </div>
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
                    onClick={() => void copyResumeCommand()}
                    disabled={!selected}
                  >
                    Copy resume command
                  </button>
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => void openResumeInCli()}
                    disabled={!selected || resumeBusy}
                  >
                    {resumeBusy ? "Opening..." : "Open in CLI"}
                  </button>
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
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => setShowMeta((prev) => !prev)}
                  >
                    {showMeta ? "Hide meta" : "Show meta"}
                  </button>
                </div>
                {resumeError ? <div className="banner error">{resumeError}</div> : null}
                {resumeNotice ? <p className="panel-note">{resumeNotice}</p> : null}
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
                {loadingOlder ? <p className="panel-note">Loading older…</p> : null}
                {messagesTotal !== null && messagesTotal > messages.length ? (
                  <p className="panel-note">
                    Showing latest {messages.length} of {messagesTotal} messages.
                  </p>
                ) : null}
                {messagesLoading ? <p className="ghost">Loading transcript...</p> : null}
                {messagesError ? <div className="banner error">{messagesError}</div> : null}
                <div className="chat-messages">
                  {visibleMessages.length === 0 && !messagesLoading ? (
                    <p className="ghost">No messages yet.</p>
                  ) : null}
                  {visibleMessages.map((message) => {
                    const kind = normalizeKind(message);
                    if (kind === "reasoning") {
                      return <ThinkingBlock key={message.id} message={message} />;
                    }
                    if (kind === "tool") {
                      return <ToolCallCard key={message.id} message={message} />;
                    }
                    if (kind === "developer") {
                      return (
                        <TranscriptMetaRow
                          key={message.id}
                          message={message}
                          label="Developer"
                        />
                      );
                    }
                    if (kind === "meta") {
                      return showMeta ? (
                        <TranscriptMetaRow key={message.id} message={message} />
                      ) : null;
                    }
                    if (isBubbleKind(kind)) {
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
                              <ChatMarkdown content={message.content} />
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
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
      {newChatOpen ? (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-header">
              <h2>New chat</h2>
              <button className="ghost-button" onClick={() => setNewChatOpen(false)}>
                Close
              </button>
            </div>
            {commandError ? <div className="banner error">{commandError}</div> : null}
            <div className="form-grid compact">
              <label>
                Workspace
                <select
                  value={workspaceChoice}
                  onChange={(event) => applyWorkspaceSelection(event.target.value)}
                >
                  <option value="custom">Custom workspace</option>
                  {workspaces.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name ? `${entry.name} · ${entry.path}` : entry.path}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Workspace name
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="span-2">
                Workspace path
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(event) => {
                    setWorkspaceChoice("custom");
                    setWorkspacePath(event.target.value);
                  }}
                  placeholder="C:\\projects\\repo"
                />
              </label>
              <label>
                Profile
                <input
                  type="text"
                  value={workspaceProfile}
                  onChange={(event) => setWorkspaceProfile(event.target.value)}
                  placeholder="Optional profile"
                />
              </label>
              <label>
                Model
                <input
                  type="text"
                  value={formModel}
                  onChange={(event) => setFormModel(event.target.value)}
                  placeholder="gpt-5-codex"
                />
              </label>
              <label>
                Sandbox
                <select
                  value={formSandbox}
                  onChange={(event) => setFormSandbox(event.target.value)}
                >
                  <option value="read-only">Read-only</option>
                  <option value="workspace-write">Workspace write</option>
                  <option value="danger-full-access">Full access</option>
                </select>
              </label>
              <label>
                Approvals
                <select
                  value={formApprovals}
                  onChange={(event) => setFormApprovals(event.target.value)}
                >
                  <option value="untrusted">Untrusted</option>
                  <option value="on-failure">On failure</option>
                  <option value="on-request">On request</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={formSearch}
                  onChange={(event) => setFormSearch(event.target.checked)}
                />
                Enable search
              </label>
              <label className="span-2">
                Prompt
                <textarea
                  value={formPrompt}
                  onChange={(event) => setFormPrompt(event.target.value)}
                  placeholder="Optional prompt to start the chat"
                />
              </label>
            </div>
            <div className="command-preview">
              {commandBusy
                ? "Building command..."
                : commandPreview?.display ?? "Enter a workspace path to preview the command."}
            </div>
            {commandResult ? (
              <div className="command-output">
                <div className="command-output-row">
                  <span>Status</span>
                  <span>
                    {commandResult.timed_out
                      ? "Timed out"
                      : commandResult.exit_code === 0
                        ? "Exited 0"
                        : `Exited ${commandResult.exit_code ?? "?"}`}
                  </span>
                </div>
                {commandResult.stdout ? (
                  <pre>{commandResult.stdout}</pre>
                ) : null}
                {commandResult.stderr ? (
                  <pre className="error">{commandResult.stderr}</pre>
                ) : null}
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setNewChatOpen(false)}>
                Cancel
              </button>
              <button
                className="ghost-button"
                onClick={() => void copyNewChatCommand()}
                disabled={commandBusy || !workspacePath.trim()}
              >
                Copy command
              </button>
              <button
                className="primary"
                onClick={() => void runNewChatCommand()}
                disabled={commandBusy || !workspacePath.trim()}
              >
                {commandBusy ? "Running..." : "Open in CLI"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
