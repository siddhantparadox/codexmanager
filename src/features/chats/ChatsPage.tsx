import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatOverlaySet,
  chatSessionLatest,
  chatSessionPage,
  chatSessionsList,
  codexBuildCommand,
  readWorkspaceConfigText,
  workspacesList,
  workspacesUpsert
} from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type {
  CodexCommandPreview,
  CodexCommandRequest,
  CodexRunOptions,
  ChatMessage,
  ChatMessagesPage,
  ChatSessionSummary,
  ChatSessionsResponse,
  ConfigText,
  ConfigPathChange,
  JsonValue,
  WorkspaceEntry
} from "../../lib/types";
import { useAppState } from "../../store/appStore";
import {
  APPROVAL_POLICIES,
  CODEX_MODELS,
  REASONING_EFFORTS,
  SANDBOX_MODES,
  WEB_SEARCH_MODES
} from "../../lib/codexConfigBasics";
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

type ConfigDefaultsBaseline = {
  model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  web_search?: string;
  model_reasoning_effort?: string;
};

type WorkspaceOverrideField = {
  value: string;
  touched: boolean;
};

type WorkspaceOverridesDraft = {
  model: WorkspaceOverrideField;
  approval_policy: WorkspaceOverrideField;
  sandbox_mode: WorkspaceOverrideField;
  web_search: WorkspaceOverrideField;
  model_reasoning_effort: WorkspaceOverrideField;
};

type OverrideKey = keyof WorkspaceOverridesDraft;

type PendingAction = "copy" | null;
type WorkspaceConfigIssue =
  | "not_registered"
  | "not_found"
  | "not_directory"
  | "required"
  | "unknown";

async function copyToClipboard(text: string) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  const selection = document.getSelection();
  const active = document.activeElement as HTMLElement | null;
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  if (active) {
    active.focus();
  }
  selection?.removeAllRanges();
  if (!ok) {
    throw new Error("Copy failed.");
  }
}

function normalizeKind(message: ChatMessage) {
  return (message.kind ?? message.role ?? "meta").toLowerCase();
}

function isBubbleKind(kind: string) {
  return kind === "user" || kind === "assistant";
}

function getPathValue(value: JsonValue | null | undefined, path: string[]): JsonValue | undefined {
  if (!value || path.length === 0) {
    return value ?? undefined;
  }
  let current: JsonValue | undefined = value ?? undefined;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, JsonValue>)[key];
  }
  return current;
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseAppError(error: unknown): { code?: string; message?: string } {
  if (!error) return {};
  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { code?: string; message?: string };
        if (parsed && (parsed.code || parsed.message)) {
          return parsed;
        }
      } catch {
        return { message: error };
      }
    }
    return { message: error };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    const message = typeof record.message === "string" ? record.message : undefined;
    if (code || message) return { code, message };
  }
  return { message: normalizeError(error) };
}

function buildConfigBaseline(parsed: JsonValue | null | undefined): ConfigDefaultsBaseline {
  return {
    model: getStringValue(getPathValue(parsed, ["model"])),
    approval_policy: getStringValue(getPathValue(parsed, ["approval_policy"])),
    sandbox_mode: getStringValue(getPathValue(parsed, ["sandbox_mode"])),
    web_search: getStringValue(getPathValue(parsed, ["web_search"])),
    model_reasoning_effort: getStringValue(
      getPathValue(parsed, ["model_reasoning_effort"])
    )
  };
}

function mergeBaselines(
  globalBaseline: ConfigDefaultsBaseline,
  workspaceBaseline: ConfigDefaultsBaseline
): ConfigDefaultsBaseline {
  return {
    model: workspaceBaseline.model ?? globalBaseline.model,
    approval_policy: workspaceBaseline.approval_policy ?? globalBaseline.approval_policy,
    sandbox_mode: workspaceBaseline.sandbox_mode ?? globalBaseline.sandbox_mode,
    web_search: workspaceBaseline.web_search ?? globalBaseline.web_search,
    model_reasoning_effort:
      workspaceBaseline.model_reasoning_effort ?? globalBaseline.model_reasoning_effort
  };
}

export default function ChatsPage() {
  const {
    scan,
    configText,
    loadConfig,
    openPreview,
    lastAppliedAt,
    preview,
    settingsDraft,
    saveSettings
  } = useAppState();
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
  const [workspaceConfigText, setWorkspaceConfigText] = useState<ConfigText | null>(
    null
  );
  const [workspaceConfigExists, setWorkspaceConfigExists] = useState(false);
  const [workspaceConfigError, setWorkspaceConfigError] = useState<string | null>(
    null
  );
  const [workspaceConfigIssue, setWorkspaceConfigIssue] =
    useState<WorkspaceConfigIssue | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [workspaceChoice, setWorkspaceChoice] = useState("custom");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceProfile, setWorkspaceProfile] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [overridesDraft, setOverridesDraft] = useState<WorkspaceOverridesDraft>({
    model: { value: "", touched: false },
    approval_policy: { value: "", touched: false },
    sandbox_mode: { value: "", touched: false },
    web_search: { value: "", touched: false },
    model_reasoning_effort: { value: "", touched: false }
  });
  const overridesInitialRef = useRef<Record<OverrideKey, string>>({
    model: "",
    approval_policy: "",
    sandbox_mode: "",
    web_search: "",
    model_reasoning_effort: ""
  });
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingActionAt, setPendingActionAt] = useState(0);
  const [commandPreview, setCommandPreview] = useState<CodexCommandPreview | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandCopyNotice, setCommandCopyNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoLoadRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const globalBaseline = useMemo(
    () => buildConfigBaseline(configText?.parsed),
    [configText?.parsed]
  );
  const workspaceBaseline = useMemo(
    () => buildConfigBaseline(workspaceConfigText?.parsed),
    [workspaceConfigText?.parsed]
  );
  const configBaseline = useMemo(
    () => mergeBaselines(globalBaseline, workspaceBaseline),
    [globalBaseline, workspaceBaseline]
  );

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

  const loadWorkspaceConfig = useCallback(async (workspaceRoot: string) => {
    const trimmed = workspaceRoot.trim();
    if (!trimmed) {
      setWorkspaceConfigText(null);
      setWorkspaceConfigExists(false);
      setWorkspaceConfigError(null);
      setWorkspaceConfigIssue(null);
      return;
    }
    try {
      const text = await readWorkspaceConfigText(trimmed);
      setWorkspaceConfigText(text);
      setWorkspaceConfigExists(text.exists ?? true);
      setWorkspaceConfigError(null);
      setWorkspaceConfigIssue(null);
    } catch (err) {
      const parsed = parseAppError(err);
      const message = parsed.message ?? normalizeError(err);
      const lowered = message.toLowerCase();
      let issue: WorkspaceConfigIssue | null = null;
      let friendlyMessage = message;
      if (parsed.code === "workspace_root") {
        if (lowered.includes("not registered")) {
          issue = "not_registered";
          friendlyMessage =
            "Workspace isn't registered. Add this folder in Settings → Repo roots to save defaults. Until then, overrides apply only to this command.";
        } else if (lowered.includes("not found")) {
          issue = "not_found";
          friendlyMessage = "Workspace folder not found.";
        } else if (lowered.includes("directory")) {
          issue = "not_directory";
          friendlyMessage = "Workspace path must be a folder.";
        } else if (lowered.includes("required")) {
          issue = "required";
          friendlyMessage = "Workspace path is required.";
        } else {
          issue = "unknown";
        }
      }
      setWorkspaceConfigText(null);
      setWorkspaceConfigExists(false);
      setWorkspaceConfigIssue(issue);
      setWorkspaceConfigError(friendlyMessage);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!newChatOpen) return;
    if (!scan?.config.exists) return;
    if (!configText) {
      void loadConfig({ silent: true, showNotice: false });
    }
  }, [configText, loadConfig, newChatOpen, scan?.config.exists]);

  useEffect(() => {
    if (!newChatOpen) return;
    void loadWorkspaceConfig(workspacePath);
  }, [lastAppliedAt, loadWorkspaceConfig, newChatOpen, workspacePath]);

  useEffect(() => {
    if (workspaceConfigIssue !== "not_registered") {
      setRegisterError(null);
    }
  }, [workspaceConfigIssue]);

  useEffect(() => {
    if (!newChatOpen) return;
    const next = {
      model: configBaseline.model ?? "",
      approval_policy: configBaseline.approval_policy ?? "",
      sandbox_mode: configBaseline.sandbox_mode ?? "",
      web_search: configBaseline.web_search ?? "",
      model_reasoning_effort: configBaseline.model_reasoning_effort ?? ""
    };
    overridesInitialRef.current = next;
    setOverridesDraft({
      model: { value: next.model, touched: false },
      approval_policy: { value: next.approval_policy, touched: false },
      sandbox_mode: { value: next.sandbox_mode, touched: false },
      web_search: { value: next.web_search, touched: false },
      model_reasoning_effort: { value: next.model_reasoning_effort, touched: false }
    });
    setCommandCopyNotice(null);
    setCommandError(null);
    setRegisterError(null);
    setRegisterBusy(false);
  }, [configBaseline, newChatOpen]);

  useEffect(() => {
    const handleFocus = () => {
      void loadSessions();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSessions]);

  const sessions = useMemo(() => {
    const list = state.data?.sessions
      ? state.data.sessions.filter(
          (session) => (session.last_cwd ?? "").trim().length > 0
        )
      : [];
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
    const filtered = showMeta
      ? messages
      : messages.filter((message) => normalizeKind(message) !== "meta");
    const deduped: ChatMessage[] = [];
    for (const message of filtered) {
      const kind = normalizeKind(message);
      if (isBubbleKind(kind)) {
        const previous = deduped[deduped.length - 1];
        if (previous && isBubbleKind(normalizeKind(previous))) {
          const sameRole = previous.role === message.role;
          const sameContent = previous.content === message.content;
          const prevTs = previous.timestamp ?? null;
          const nextTs = message.timestamp ?? null;
          const sameTime =
            prevTs !== null && nextTs !== null
              ? Math.abs(prevTs - nextTs) <= 1
              : prevTs === null && nextTs === null;
          if (sameRole && sameContent && sameTime) {
            continue;
          }
        }
      }
      deduped.push(message);
    }
    return deduped;
  }, [messages, showMeta]);

  const globalConfigPath = scan?.config.path ?? "CODEX_HOME/config.toml";
  const workspaceConfigPath = useMemo(() => {
    const trimmed = workspacePath.trim().replace(/[\\/]+$/, "");
    if (!trimmed) {
      return ".codex/config.toml";
    }
    const separator = trimmed.includes("\\") ? "\\.codex\\config.toml" : "/.codex/config.toml";
    return `${trimmed}${separator}`;
  }, [workspacePath]);

  const sessionsPath = state.data?.sessions_path ?? "CODEX_HOME/sessions";

  const buildResumeRequest = useCallback(
    (session: ChatSessionSummary): CodexCommandRequest => ({
      kind: "resume",
      session_id: formatSessionLabel(session.id),
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
    void copyToClipboard(id)
      .then(() => {
        setCopyNotice("Copied");
        window.setTimeout(() => setCopyNotice(null), 1500);
      })
      .catch((err) => setCopyNotice(normalizeError(err)));
  }, [selected]);

  const copyResumeCommand = useCallback(async () => {
    if (!selected) return;
    setResumeError(null);
    setResumeNotice(null);
    try {
      const preview = await codexBuildCommand(buildResumeRequest(selected));
      await copyToClipboard(preview.display);
      setResumeNotice("Resume command copied.");
      window.setTimeout(() => setResumeNotice(null), 2000);
    } catch (err) {
      setResumeError(normalizeError(err));
    }
  }, [buildResumeRequest, selected]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedId || messagesCursor === null || loadingOlder) return;
    stickToBottomRef.current = false;
    setShowJump(true);
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
      setWorkspaceProfile(entry.default_profile ?? entry.last_run?.profile ?? "");
    },
    [workspaces]
  );

  const registerWorkspaceRoot = useCallback(async () => {
    const trimmed = workspacePath.trim();
    if (!trimmed) return;
    const settings = settingsDraft ?? scan?.settings;
    if (!settings) {
      setRegisterError("Unable to load settings.");
      return;
    }
    setRegisterError(null);
    const currentRoots = settings.repo_roots ?? [];
    const nextRoots = Array.from(new Set([...currentRoots, trimmed]));
    if (nextRoots.length === currentRoots.length) {
      await loadWorkspaceConfig(trimmed);
      return;
    }
    setRegisterBusy(true);
    const ok = await saveSettings({ ...settings, repo_roots: nextRoots });
    setRegisterBusy(false);
    if (!ok) {
      setRegisterError("Unable to update repo roots.");
      return;
    }
    await loadWorkspaceConfig(trimmed);
  }, [loadWorkspaceConfig, saveSettings, scan?.settings, settingsDraft, workspacePath]);

  const updateOverride = useCallback((key: OverrideKey, value: string) => {
    const initial = overridesInitialRef.current[key] ?? "";
    setOverridesDraft((prev) => ({
      ...prev,
      [key]: { value, touched: value.trim() !== initial.trim() }
    }));
  }, []);

  const resetOverrideIfEmpty = useCallback((key: OverrideKey) => {
    setOverridesDraft((prev) => {
      if (prev[key].value.trim()) {
        return prev;
      }
      const initial = overridesInitialRef.current[key] ?? "";
      return { ...prev, [key]: { value: initial, touched: false } };
    });
  }, []);

  const buildOverridesChanges = useCallback((): ConfigPathChange[] => {
    const changes: ConfigPathChange[] = [];
    const pushString = (path: string[], field: WorkspaceOverrideField) => {
      if (!field.touched) return;
      const trimmed = field.value.trim();
      if (!trimmed) return;
      changes.push({
        path,
        value: { kind: "string", value: trimmed }
      });
    };

    pushString(["model"], overridesDraft.model);
    pushString(["approval_policy"], overridesDraft.approval_policy);
    pushString(["sandbox_mode"], overridesDraft.sandbox_mode);
    pushString(["web_search"], overridesDraft.web_search);
    pushString(["model_reasoning_effort"], overridesDraft.model_reasoning_effort);

    return changes;
  }, [overridesDraft]);

  const overridesSummary = useMemo(() => {
    const changes = buildOverridesChanges();
    if (!changes.length) return null;
    const labelFor = (key: string, value: string) => {
      switch (key) {
        case "approval_policy":
          return APPROVAL_POLICIES.find((policy) => policy.value === value)?.label;
        case "sandbox_mode":
          return SANDBOX_MODES.find((mode) => mode.value === value)?.label;
        case "web_search":
          return WEB_SEARCH_MODES.find((mode) => mode.value === value)?.label;
        case "model_reasoning_effort":
          return REASONING_EFFORTS.find((effort) => effort.value === value)?.label;
        default:
          return null;
      }
    };
    const labelForKey = (key: string) => {
      switch (key) {
        case "model":
          return "Model";
        case "approval_policy":
          return "Approvals";
        case "sandbox_mode":
          return "Sandbox";
        case "web_search":
          return "Web search";
        case "model_reasoning_effort":
          return "Reasoning";
        default:
          return key;
      }
    };
    const parts = changes.map((change) => {
      const key = change.path[0] ?? "";
      const rawValue = String(change.value.value ?? "");
      const labelValue = labelFor(key, rawValue) ?? rawValue;
      return `${labelForKey(key)} ${labelValue}`;
    });
    return parts.join(" · ");
  }, [buildOverridesChanges]);

  const modelOptions = useMemo(() => {
    const options: string[] = [];
    const seen = new Set<string>();
    const push = (value?: string | null) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push(trimmed);
    };
    (state.data?.sessions ?? [])
      .map((session) => session.last_model)
      .forEach((model) => push(model));
    CODEX_MODELS.forEach((model) => push(model));
    push(configBaseline.model);
    push(overridesDraft.model.value);
    return options;
  }, [configBaseline.model, overridesDraft.model.value, state.data?.sessions]);

  const supportsXHigh = useMemo(() => {
    const modelValue = overridesDraft.model.value.trim() || configBaseline.model || "";
    return modelValue.toLowerCase().startsWith("gpt-5.2");
  }, [configBaseline.model, overridesDraft.model.value]);

  const reasoningOptions = useMemo(
    () =>
      REASONING_EFFORTS.filter((effort) => supportsXHigh || effort.value !== "xhigh"),
    [supportsXHigh]
  );

  useEffect(() => {
    if (supportsXHigh) return;
    if (overridesDraft.model_reasoning_effort.value !== "xhigh") return;
    updateOverride("model_reasoning_effort", "high");
  }, [
    overridesDraft.model_reasoning_effort.value,
    supportsXHigh,
    updateOverride
  ]);

  const buildNewChatRequest = useCallback((): CodexCommandRequest => {
    const options: CodexRunOptions = {
      cwd: workspacePath || null,
      profile: workspaceProfile || null,
      prompt: formPrompt || null
    };
    if (overridesDraft.model.touched) {
      options.model = overridesDraft.model.value.trim() || null;
    }
    if (overridesDraft.sandbox_mode.touched) {
      options.sandbox = overridesDraft.sandbox_mode.value.trim() || null;
    }
    if (overridesDraft.approval_policy.touched) {
      options.approvals = overridesDraft.approval_policy.value.trim() || null;
    }
    if (overridesDraft.web_search.touched) {
      options.search = overridesDraft.web_search.value.trim() === "live";
    }
    return { kind: "new", options };
  }, [
    formPrompt,
    overridesDraft.approval_policy,
    overridesDraft.model,
    overridesDraft.sandbox_mode,
    overridesDraft.web_search,
    workspacePath,
    workspaceProfile
  ]);

  useEffect(() => {
    if (!newChatOpen) return;
    if (!workspacePath.trim()) {
      setCommandPreview(null);
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
    const trimmed = workspacePath.trim();
    if (!trimmed) return;
    const existing = workspaces.find((item) => item.id === trimmed);
    const entry: WorkspaceEntry = {
      id: trimmed,
      path: trimmed,
      name: existing?.name ?? null,
      default_profile: workspaceProfile.trim() ? workspaceProfile.trim() : null,
      last_run: {
        cwd: trimmed,
        profile: workspaceProfile.trim() ? workspaceProfile.trim() : null,
        model: overridesDraft.model.value.trim()
          ? overridesDraft.model.value.trim()
          : null,
        sandbox: overridesDraft.sandbox_mode.value.trim()
          ? overridesDraft.sandbox_mode.value.trim()
          : null,
        approvals: overridesDraft.approval_policy.value.trim()
          ? overridesDraft.approval_policy.value.trim()
          : null,
        search: overridesDraft.web_search.value.trim() === "live",
        prompt: null
      }
    };
    const updated = await workspacesUpsert(entry);
    setWorkspaces(updated);
  }, [overridesDraft, workspacePath, workspaceProfile, workspaces]);

  const performCopyCommand = useCallback(async () => {
    setCommandError(null);
    setCommandCopyNotice(null);
    setCommandBusy(true);
    try {
      const preview = await codexBuildCommand(buildNewChatRequest());
      await copyToClipboard(preview.display);
      await persistWorkspace();
      setCommandPreview(preview);
      setCommandCopyNotice("Copied");
      window.setTimeout(() => setCommandCopyNotice(null), 1500);
    } catch (err) {
      setCommandError(normalizeError(err));
    } finally {
      setCommandBusy(false);
    }
  }, [buildNewChatRequest, persistWorkspace]);

  const requestCopyCommand = useCallback(async () => {
      const trimmed = workspacePath.trim();
      setCommandError(null);
      if (!trimmed) {
        setCommandError("Workspace path is required.");
        return;
      }
      const changes = buildOverridesChanges();
      const canSaveOverrides =
        changes.length > 0 &&
        !workspaceConfigIssue &&
        !workspaceConfigText?.parse_error;
      if (!changes.length || !canSaveOverrides) {
        await performCopyCommand();
        return;
      }
      setPendingAction("copy");
      setPendingActionAt(lastAppliedAt);
      const ok = await openPreview({
        type: "set_workspace_config_paths",
        workspace_root: trimmed,
        changes
      });
      if (!ok) {
        setPendingAction(null);
        setCommandError("Unable to preview workspace overrides.");
      }
    }, [
      buildOverridesChanges,
      lastAppliedAt,
      openPreview,
      performCopyCommand,
      workspaceConfigIssue,
      workspaceConfigText?.parse_error,
      workspacePath
    ]);

  useEffect(() => {
    if (!pendingAction) return;
    if (preview) return;
    if (lastAppliedAt === pendingActionAt) {
      setPendingAction(null);
      return;
    }
    const action = pendingAction;
    setPendingAction(null);
    if (action === "copy") {
      void performCopyCommand();
    }
  }, [
    lastAppliedAt,
    pendingAction,
    pendingActionAt,
    performCopyCommand,
    preview
  ]);

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
      const nearTop = el.scrollTop < 140;
      if (messagesCursor !== null && !loadingOlder) {
        if (nearTop && !autoLoadRef.current) {
          autoLoadRef.current = true;
          void loadOlderMessages().finally(() => {
            autoLoadRef.current = false;
          });
        }
      }
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (nearTop && messagesCursor !== null) {
        stickToBottomRef.current = false;
        setShowJump(true);
      } else {
        stickToBottomRef.current = nearBottom;
        setShowJump(!nearBottom);
      }
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
        <div className="modal new-chat-modal">
          <div className="modal-card new-chat-card">
            <div className="modal-header new-chat-header">
              <div>
                <h2>New chat</h2>
                <p className="modal-subtitle">
                  Start a workspace-scoped Codex session with clean defaults.
                </p>
              </div>
              <button className="ghost-button" onClick={() => setNewChatOpen(false)}>
                Close
              </button>
            </div>
            {commandError ? <div className="banner error">{commandError}</div> : null}
            <div className="new-chat-section">
              <div className="new-chat-section-header">
                <div>
                  <h3>Workspace</h3>
                  <p className="panel-note">Pick where Codex should run.</p>
                </div>
              </div>
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
                  Profile
                  <input
                    type="text"
                    value={workspaceProfile}
                    onChange={(event) => setWorkspaceProfile(event.target.value)}
                    placeholder="Optional profile"
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
                <label className="span-2">
                  Prompt
                  <textarea
                    value={formPrompt}
                    onChange={(event) => setFormPrompt(event.target.value)}
                    placeholder="Optional prompt to start the chat"
                  />
                </label>
              </div>
            </div>
            <div className="new-chat-section">
              <div className="new-chat-section-header">
                <div>
                  <h3>Workspace defaults</h3>
                  <p className="panel-note">
                    Changes write to {workspaceConfigPath}. Global defaults from{" "}
                    {globalConfigPath} stay unchanged.
                  </p>
                  <p className="panel-note">
                    Overrides are saved when you copy the command.
                  </p>
                </div>
              </div>
              {workspaceConfigError ? (
                workspaceConfigIssue === "not_registered" ? (
                  <div className="new-chat-warning">
                    <p className="card-warning">{workspaceConfigError}</p>
                    <div className="new-chat-warning-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void registerWorkspaceRoot()}
                        disabled={registerBusy || !workspacePath.trim()}
                      >
                        {registerBusy ? "Adding..." : "Add to repo roots"}
                      </button>
                      {registerError ? (
                        <span className="card-warning">{registerError}</span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="banner error">{workspaceConfigError}</div>
                )
              ) : null}
              {!scan?.config.exists ? (
                <p className="panel-note">Global config not found; using defaults.</p>
              ) : null}
              {!workspacePath.trim() ? (
                <p className="ghost">Set a workspace path to edit defaults.</p>
              ) : workspaceConfigIssue === "not_registered" ? null : workspaceConfigText?.parse_error ? (
                <p className="card-warning">{workspaceConfigText.parse_error}</p>
              ) : !workspaceConfigExists ? (
                <p className="panel-note">
                  No workspace config yet. Changes will create {workspaceConfigPath}.
                </p>
              ) : null}
              <div className="form-grid compact">
                <label>
                  Model
                  <input
                    type="text"
                    list="codex-models"
                    value={overridesDraft.model.value}
                    onChange={(event) => updateOverride("model", event.target.value)}
                    onBlur={() => resetOverrideIfEmpty("model")}
                    placeholder="gpt-5.2-codex"
                  />
                  <datalist id="codex-models">
                    {modelOptions.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Approval policy
                  <select
                    value={overridesDraft.approval_policy.value}
                    onChange={(event) =>
                      updateOverride("approval_policy", event.target.value)
                    }
                  >
                    {overridesDraft.approval_policy.value ? null : (
                      <option value="" disabled>
                        Default
                      </option>
                    )}
                    {APPROVAL_POLICIES.map((policy) => (
                      <option key={policy.value} value={policy.value}>
                        {policy.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sandbox mode
                  <select
                    value={overridesDraft.sandbox_mode.value}
                    onChange={(event) =>
                      updateOverride("sandbox_mode", event.target.value)
                    }
                  >
                    {overridesDraft.sandbox_mode.value ? null : (
                      <option value="" disabled>
                        Default
                      </option>
                    )}
                    {SANDBOX_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Web search
                  <select
                    value={overridesDraft.web_search.value}
                    onChange={(event) => updateOverride("web_search", event.target.value)}
                  >
                    {overridesDraft.web_search.value ? null : (
                      <option value="" disabled>
                        Default
                      </option>
                    )}
                    {WEB_SEARCH_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  Reasoning effort
                  <select
                    value={overridesDraft.model_reasoning_effort.value}
                    onChange={(event) =>
                      updateOverride("model_reasoning_effort", event.target.value)
                    }
                  >
                    {overridesDraft.model_reasoning_effort.value ? null : (
                      <option value="" disabled>
                        Default
                      </option>
                    )}
                    {reasoningOptions.map((effort) => (
                      <option key={effort.value} value={effort.value}>
                        {effort.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="panel-note">
                {supportsXHigh
                  ? "XHigh is available for GPT-5.2 family models."
                  : "XHigh is only available on GPT-5.2 family models."}
              </p>
            </div>
            <div className="new-chat-command">
              <div className="new-chat-command-row">
                <div className="new-chat-command-preview">
                  <div className="new-chat-command-text">
                    {commandBusy
                      ? "Building command..."
                      : commandPreview?.display ??
                        "Enter a workspace path to preview the command."}
                  </div>
                  {overridesSummary && workspacePath.trim() ? (
                    <div className="new-chat-command-meta">
                      Overrides: {overridesSummary}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void requestCopyCommand()}
                  disabled={commandBusy || !workspacePath.trim()}
                >
                  Copy
                </button>
                {commandCopyNotice ? (
                  <span className="pill">{commandCopyNotice}</span>
                ) : null}
              </div>
            </div>
            <div className="modal-actions new-chat-actions">
              <button className="ghost-button" onClick={() => setNewChatOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
