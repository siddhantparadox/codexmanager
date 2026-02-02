export type CodexFeatureMaturity = "Experimental" | "Beta" | "Stable" | "Deprecated";

export type CodexFeature = {
  key: string;
  default: boolean;
  maturity: CodexFeatureMaturity;
  description: string;
};

export const CODEX_FEATURES: CodexFeature[] = [
  {
    key: "apply_patch_freeform",
    default: false,
    maturity: "Experimental",
    description: "Include the freeform apply_patch tool."
  },
  {
    key: "elevated_windows_sandbox",
    default: false,
    maturity: "Experimental",
    description: "Use the elevated Windows sandbox pipeline."
  },
  {
    key: "exec_policy",
    default: true,
    maturity: "Experimental",
    description: "Enforce rules checks for shell/unified_exec."
  },
  {
    key: "experimental_windows_sandbox",
    default: false,
    maturity: "Experimental",
    description: "Use the Windows restricted-token sandbox."
  },
  {
    key: "remote_compaction",
    default: true,
    maturity: "Experimental",
    description: "Enable remote compaction (ChatGPT auth only)."
  },
  {
    key: "remote_models",
    default: false,
    maturity: "Experimental",
    description: "Refresh remote model list before showing readiness."
  },
  {
    key: "request_rule",
    default: true,
    maturity: "Stable",
    description: "Enable Smart approvals (prefix_rule suggestions)."
  },
  {
    key: "shell_snapshot",
    default: false,
    maturity: "Beta",
    description: "Snapshot your shell environment to speed up repeated commands."
  },
  {
    key: "shell_tool",
    default: true,
    maturity: "Stable",
    description: "Enable the default shell tool."
  },
  {
    key: "unified_exec",
    default: false,
    maturity: "Beta",
    description: "Use the unified PTY-backed exec tool."
  },
  {
    key: "undo",
    default: true,
    maturity: "Stable",
    description: "Enable undo via per-turn git ghost snapshots."
  },
  {
    key: "web_search",
    default: true,
    maturity: "Deprecated",
    description: "Legacy toggle; prefer the top-level web_search setting."
  },
  {
    key: "web_search_cached",
    default: true,
    maturity: "Deprecated",
    description: "Legacy toggle that maps to web_search = \"cached\" when unset."
  },
  {
    key: "web_search_request",
    default: true,
    maturity: "Deprecated",
    description: "Legacy toggle that maps to web_search = \"live\" when unset."
  }
];

export const APPROVAL_POLICIES = [
  { value: "untrusted", label: "Untrusted" },
  { value: "on-request", label: "On request" },
  { value: "on-failure", label: "On failure" },
  { value: "never", label: "Never" }
];

export const SANDBOX_MODES = [
  { value: "read-only", label: "Read-only" },
  { value: "workspace-write", label: "Workspace write" },
  { value: "danger-full-access", label: "Full access" }
];

export const WEB_SEARCH_MODES = [
  { value: "cached", label: "Cached (default)" },
  { value: "live", label: "Live" },
  { value: "disabled", label: "Disabled" }
];

export const REASONING_EFFORTS = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" }
];

export const CODEX_MODELS = [
  "gpt-5.2-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5"
];
