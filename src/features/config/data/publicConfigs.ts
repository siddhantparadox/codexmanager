export type PublicConfigEntry = {
  id: string;
  title: string;
  url: string;
  summary: string;
  config: string;
};

export const PUBLIC_CONFIGS: PublicConfigEntry[] = [
  {
    id: "steipete-inference-speed",
    title: "Shipping at inference speed (Peter Steinberger)",
    url: "https://steipete.me/posts/2025/shipping-at-inference-speed#my-config",
    summary: "High-throughput Codex defaults with safe compaction headroom.",
    config: `model = "gpt-5.2-codex"
model_reasoning_effort = "high"
tool_output_token_limit = 25000
# Leave room for native compaction near the 272273k context window.
# Formula: 273000 - (tool_output_token_limit + 15000)
# With tool_output_token_limit=25000  273000 - (25000 + 15000) = 233000
model_auto_compact_token_limit = 233000
[features]
ghost_commit = false
unified_exec = true
apply_patch_freeform = true
web_search_request = true
skills = true
shell_snapshot = true

[projects."/Users/steipete/Projects"]
trust_level = "trusted"
`
  }
];
