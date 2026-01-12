# AGENTS.md — AI Coding Guide for Codex Manager (Tauri)

This repo builds a **Codex Manager** desktop app. It manages Codex config/assets (files) and optionally runs a small allowlist of Codex CLI management commands.

## 1) Prime directive
- **Do not build a Codex runner.**
- **Do not add “run arbitrary command” features.**
- The app edits/organizes files + optionally calls **whitelisted** Codex CLI management subcommands.

If a requested change would turn this into an agent host, refuse and suggest an alternative within scope.

---

## 2) What the app manages (canonical on-disk sources)
Treat on-disk artifacts as the source of truth:
- `CODEX_HOME/config.toml`
- `CODEX_HOME/skills/**`
- `REPO_ROOT/.codex/skills/**`
- `CODEX_HOME/prompts/**`
- `CODEX_HOME/rules/*.rules`
- Optional managed/system layers (read-only unless explicitly editable)

The app may maintain an internal **cache/index**, but never as canonical truth.

---

## 3) Safety requirements (must-follow)
### 3.1 File edits
- Always do **backup -> diff preview -> atomic write -> re-validate**.
- Preserve unknown keys.
- Avoid rewriting whole TOML files when a targeted patch will do.
- Keep TOML structural constraints intact (root keys before tables).

### 3.2 Subprocess execution
- Only execute a **hardcoded allowlist** of Codex CLI commands.
- Never execute user-entered command strings.
- Always show the exact command that will run.
- Enforce timeouts; capture stdout/stderr.

### 3.3 Secrets
- Never print tokens or auth file contents.
- When showing token configuration, show **only the env var name**, not its value.
- Mask sensitive strings in logs and UI.

---

## 4) Repo structure (recommended)
(Adjust if the repo differs, but keep responsibilities similar.)

- `src-tauri/` — Rust backend
  - `fs/` file discovery, watchers, atomic writes, backup
  - `codex/` CLI detection + allowlisted command runner
  - `models/` typed structs for config/mcp/skills/prompts/rules
  - `toml_edit/` round-trip safe config patching
  - `commands.rs` Tauri commands exposed to frontend
- `src/` - frontend
  - `features/` feature-first UI modules
  - `components/` reusable UI
  - `layouts/` app shell + chrome
  - `store/` state management
  - `lib/` typed wrappers and shared utilities

---

## 5) Coding standards
### Rust (backend)
- Prefer small, testable modules.
- All filesystem writes must be atomic and use backups.
- Return structured errors to UI (error codes + human text).
- Add unit tests for:
  - TOML patching
  - backup/restore
  - path resolution

### Frontend
- Keep UI state deterministic.
- Use schema-based form validation.
- Always show a diff preview before applying changes.
- Never store secrets in frontend state longer than necessary.
- Prefer modular, feature-based structure over monolithic files.
- Keep `App.tsx` thin; route to feature pages and compose shared UI from `components/`.

---

## 6) How to implement a new feature (agent checklist)
When asked to implement something:

1) **Clarify scope**
   - Confirm it’s a “manager” feature (files + whitelisted CLI), not “run Codex.”

2) **Locate canonical files**
   - Identify the file(s)/folders affected.

3) **Design UX and backend flow**
   - Read -> validate -> render
   - Edit -> diff -> backup -> atomic write -> re-validate

4) **Update the data model**
   - Add typed structs for the new artifact.

5) **Add validation**
   - Parsing + semantic checks + warnings.

6) **Write tests**
   - At least for patching/serialization.

7) **Security review**
   - Ensure no secrets are leaked.
   - Ensure no arbitrary subprocess execution.

8) **Docs**
   - Update `DesignDoc.md` if the feature changes flows or architecture.

---

## 7) TOML patching rules (important)
### Goal
Make minimal, surgical changes to `config.toml`:
- Toggle MCP server `enabled`
- Add/edit/remove an `[mcp_servers.<name>]` table
- Edit root keys or profile tables without reformatting unrelated sections

### Strategy
Prefer a document-aware approach:
- Parse for validation
- Patch by updating only the target block
- Keep ordering stable

If a full re-serialize is unavoidable, preserve:
- unknown keys
- table ordering
- root keys before tables

Add regression tests to ensure:
- comments aren’t destroyed (or are predictably handled)
- toggling an MCP server doesn’t reorder the entire file

---

## 9) UI principles
- Prefer wizards for MCP add flows.
- Provide “Simple” vs “Advanced” views for config.
- Always show:
  - what file will change
  - a diff preview
  - a restore option

Make precedence visible:
- show scope/source badges
- show conflict resolution actions for skills

---

## 10) Testing expectations
At minimum:
- Unit tests for TOML patcher
- Unit tests for backup/restore
- Integration-ish tests that simulate:
  - add MCP server
  - toggle enabled
  - import bundle with collisions

Add fixtures under `src-tauri/tests/fixtures/`.

Always run tests after each code modification. At minimum:
- `cargo test --manifest-path src-tauri/Cargo.toml`

---

## 11) Common pitfalls to avoid
- Overwriting `config.toml` formatting/comments unnecessarily.
- Deleting unknown keys.
- Logging sensitive data.
- Running any non-allowlisted CLI command.
- Treating internal index/cache as truth.

---

## 12) Suggested PR template (for agents)
Include in PR description:
- What user flow changed?
- Which files are read/written?
- How is it validated?
- How is it backed up/restored?
- Any security implications?
- Tests added/updated
