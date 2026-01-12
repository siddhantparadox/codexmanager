import { useMemo, useState } from "react";
import { listSkillFiles, readSkillText } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type { SkillFileCounts, SkillFileEntry, SkillSummary } from "../../lib/types";
import { useAppState } from "../../store/appStore";

type SkillDraft = {
  name: string;
  scope: "user" | "repo";
  repo_root: string;
  content: string;
};

const NEW_SKILL_TEMPLATE = `---
name: new-skill
description: Short description
---

# New Skill
Describe behavior here.
`;

const FOLDER_GROUPS = [
  { key: "scripts", label: "scripts/" },
  { key: "references", label: "references/" },
  { key: "assets", label: "assets/" }
] as const;

const FOLDER_ALIASES: Record<string, string[]> = {
  scripts: ["scripts", "script"],
  references: ["references", "reference"],
  assets: ["assets", "asset"]
};

const TEXT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "toml",
  "json",
  "yaml",
  "yml",
  "ini",
  "cfg",
  "conf",
  "env",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "scss",
  "html",
  "htm",
  "rs",
  "py",
  "sh",
  "ps1",
  "bat",
  "cmd",
  "csv",
  "xml",
  "svg",
  "sql"
]);

function formatSkillCounts(counts: SkillFileCounts) {
  const parts: { key: string; label: string }[] = [];
  if (counts.skill_md > 0) {
    parts.push({ key: "skill", label: "SKILL.md" });
  }
  if (counts.references > 0) {
    parts.push({
      key: "references",
      label: `${counts.references} reference${counts.references === 1 ? "" : "s"}`
    });
  }
  if (counts.scripts > 0) {
    parts.push({
      key: "scripts",
      label: `${counts.scripts} script${counts.scripts === 1 ? "" : "s"}`
    });
  }
  if (counts.assets > 0) {
    parts.push({
      key: "assets",
      label: `${counts.assets} asset${counts.assets === 1 ? "" : "s"}`
    });
  }
  if (counts.other > 0) {
    parts.push({ key: "other", label: `${counts.other} other` });
  }
  return parts;
}

function isTextFile(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith("skill.md")) {
    return true;
  }
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  return TEXT_EXTENSIONS.has(ext);
}

function buildFolderGroups(files: SkillFileEntry[]) {
  const dirEntries = files.filter((file) => file.kind === "dir");
  const otherItems = files
    .filter((file) => file.kind === "file" && file.category === "other")
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const groups = FOLDER_GROUPS.map((group) => {
    const items = files
      .filter((file) => file.kind === "file" && file.category === group.key)
      .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
    const aliases = FOLDER_ALIASES[group.key] ?? [group.key];
    const present =
      items.length > 0 ||
      dirEntries.some(
        (dir) => aliases.includes(dir.relative_path.split("/")[0]?.toLowerCase() ?? "")
      );
    return { ...group, items, present };
  });
  return groups.concat({
    key: "other",
    label: "other files/",
    items: otherItems,
    present: otherItems.length > 0
  });
}

export default function SkillsPage() {
  const { scan, openPreview, setBusy, setError } = useAppState();
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [skillText, setSkillText] = useState<string>("");
  const [skillFiles, setSkillFiles] = useState<SkillFileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<SkillFileEntry | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "repo">("all");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    scripts: true,
    references: true,
    assets: true
  });
  const [newSkill, setNewSkill] = useState<SkillDraft>({
    name: "",
    scope: "user",
    repo_root: "",
    content: NEW_SKILL_TEMPLATE
  });

  const folderGroups = useMemo(() => buildFolderGroups(skillFiles), [skillFiles]);
  const skillMdFile = useMemo(
    () =>
      skillFiles.find(
        (file) =>
          file.kind === "file" &&
          file.category === "skill_md" &&
          file.relative_path.toLowerCase().endsWith("skill.md")
      ) ?? null,
    [skillFiles]
  );
  const hasFiles = !!skillMdFile || folderGroups.some((group) => group.present);
  const canEditFile =
    !!activeFile && activeFile.kind === "file" && isTextFile(activeFile.relative_path);

  const filteredSkills = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (scan?.skills ?? []).filter((skill) => {
      if (scopeFilter !== "all" && skill.scope !== scopeFilter) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.dir}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [scan, query, scopeFilter]);

  function toggleFolder(key: string) {
    setExpandedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function loadSkillFile(file: SkillFileEntry | null, withBusy = true) {
    setSkillText("");
    setFileNotice(null);
    if (!file) {
      return;
    }
    if (file.kind !== "file") {
      setFileNotice("Folders cannot be previewed. Select a file to view.");
      return;
    }
    if (!isTextFile(file.relative_path)) {
      setFileNotice("Binary preview not supported. Open the file directly.");
      return;
    }
    if (withBusy) {
      setBusy(true);
    }
    setError(null);
    try {
      const text = await readSkillText(file.path);
      setSkillText(text);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      if (withBusy) {
        setBusy(false);
      }
    }
  }

  async function handleSkillSelect(skill: SkillSummary) {
    setSelectedSkill(skill);
    setSkillText("");
    setSkillFiles([]);
    setActiveFile(null);
    setFileNotice(null);
    setBusy(true);
    setError(null);
    try {
      const files = await listSkillFiles(skill.dir);
      setSkillFiles(files);
      const skillMd =
        files.find(
          (file) =>
            file.kind === "file" &&
            file.category === "skill_md" &&
            file.relative_path.toLowerCase().endsWith("skill.md")
        ) ?? null;
      setActiveFile(skillMd);
      await loadSkillFile(skillMd, false);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelect(file: SkillFileEntry) {
    if (file.kind !== "file") {
      setActiveFile(file);
      setSkillText("");
      setFileNotice("Folders cannot be previewed. Select a file to view.");
      return;
    }
    setActiveFile(file);
    await loadSkillFile(file);
  }

  return (
    <section className="split skills-layout">
      <div className="panel panel-scroll">
        <div className="panel-header">
          <h2>Skills</h2>
          <span className="panel-meta">User + repo layers</span>
        </div>
        <div className="panel-tools">
          <div className="filter-bar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, description, or path"
            />
            <select
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}
            >
              <option value="all">All scopes</option>
              <option value="user">User</option>
              <option value="repo">Repo</option>
            </select>
          </div>
        </div>
        <div className="panel-body scroll">
          {filteredSkills.length === 0 ? (
            <p className="ghost">No skills match the current filters.</p>
          ) : (
            <div className="list">
              {filteredSkills.map((skill) => {
                const counts = formatSkillCounts(skill.counts);
                return (
                  <button
                    key={skill.id}
                    className={`list-item ${selectedSkill?.id === skill.id ? "active" : ""}`}
                    onClick={() => handleSkillSelect(skill)}
                  >
                    <div className="list-row">
                      <div className="row-body">
                        <p className="row-title">{skill.name}</p>
                        {counts.length > 0 ? (
                          <div className="count-pills">
                            {counts.map((item) => (
                              <span key={item.key} className="pill">
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="row-meta">No files detected</p>
                        )}
                      </div>
                      <div className="row-actions">
                        <span className="badge info">{skill.scope}</span>
                        {skill.warnings.length > 0 ? (
                          <span className="badge warn">{skill.warnings.length} warnings</span>
                        ) : null}
                      </div>
                    </div>
                    <span className="list-path">{skill.dir}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="panel panel-scroll">
        <div className="panel-header">
          <h2>Editor</h2>
          <span className="panel-meta">
            {selectedSkill ? selectedSkill.name : "Select a skill"}
          </span>
        </div>
        {selectedSkill ? (
          <>
            <div className="panel-body scroll">
              <p className="panel-note">
                {activeFile ? (
                  <>
                    File: <strong>{activeFile.relative_path}</strong>
                  </>
                ) : (
                  "Select a file to preview."
                )}
              </p>
              <div className="file-browser">
                {hasFiles ? (
                  <>
                    {skillMdFile ? (
                      <div className="file-group">
                        <div className="file-group-title">
                          SKILL.md
                          <span className="file-group-count">1</span>
                        </div>
                        <div className="file-list">
                          <button
                            className={`file-item ${
                              activeFile?.path === skillMdFile.path ? "active" : ""
                            }`}
                            onClick={() => handleFileSelect(skillMdFile)}
                          >
                            <div>
                              <p className="file-item-name">SKILL.md</p>
                              <p className="file-item-meta">
                                Text · {skillMdFile.size ? `${skillMdFile.size} bytes` : "size unknown"}
                              </p>
                            </div>
                            <span className="file-item-tag">Edit</span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {folderGroups
                      .filter((group) => group.present)
                      .map((group) => (
                        <div className="file-group" key={group.key}>
                          <button
                            className="folder-toggle"
                            type="button"
                            onClick={() => toggleFolder(group.key)}
                          >
                            <span>{group.label}</span>
                            <span className="file-group-count">{group.items.length}</span>
                            <span className="folder-caret">
                              {expandedFolders[group.key] ? "▾" : "▸"}
                            </span>
                          </button>
                          {expandedFolders[group.key] ? (
                            <div className="file-list">
                              {group.items.length === 0 ? (
                                <p className="ghost">No files in this folder.</p>
                              ) : (
                                group.items.map((file) => {
                                  const readable = isTextFile(file.relative_path);
                                  const sizeLabel = file.size
                                    ? `${file.size} bytes`
                                    : "size unknown";
                                  const aliases = FOLDER_ALIASES[group.key] ?? [group.key];
                                  const matchedAlias =
                                    aliases.length > 0
                                      ? aliases.find((alias) =>
                                          file.relative_path
                                            .toLowerCase()
                                            .startsWith(`${alias}/`)
                                        )
                                      : null;
                                  const displayName = matchedAlias
                                    ? file.relative_path.slice(matchedAlias.length + 1)
                                    : file.relative_path;
                                  return (
                                    <button
                                      key={file.path}
                                      className={`file-item ${
                                        activeFile?.path === file.path ? "active" : ""
                                      }`}
                                      onClick={() => handleFileSelect(file)}
                                    >
                                      <div>
                                        <p className="file-item-name">{displayName}</p>
                                        <p className="file-item-meta">
                                          {readable ? "Text" : "Binary"} · {sizeLabel}
                                        </p>
                                      </div>
                                      <span className="file-item-tag">
                                        {readable ? "Edit" : "View"}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </>
                ) : (
                  <p className="ghost">No files found in this skill.</p>
                )}
              </div>
              {fileNotice ? <p className="ghost">{fileNotice}</p> : null}
              <textarea
                className="editor"
                value={skillText}
                onChange={(event) => setSkillText(event.target.value)}
                readOnly={!canEditFile}
              />
            </div>
            <div className="panel-footer">
              <div className="panel-actions">
                <button
                  className="primary"
                  onClick={() =>
                    activeFile
                      ? void openPreview({
                          type: "update_skill",
                          path: activeFile.path,
                          content: skillText
                        })
                      : undefined
                  }
                  disabled={!canEditFile}
                >
                  Preview save
                </button>
                <button
                  className="ghost-button"
                  onClick={() =>
                    activeFile
                      ? void openPreview({
                          type: "delete_skill",
                          path: activeFile.path
                        })
                      : undefined
                  }
                  disabled={!activeFile || activeFile.kind !== "file"}
                >
                  Preview delete file
                </button>
                <button
                  className="ghost-button danger"
                  onClick={() =>
                    void openPreview({
                      type: "delete_skill_folder",
                      dir: selectedSkill.dir
                    })
                  }
                >
                  Preview delete skill folder
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="ghost">Select a skill to edit.</p>
        )}
      </div>
      <div className="panel panel-scroll span-full">
        <div className="panel-header">
          <h2>Create skill</h2>
          <span className="panel-meta">Templates are editable</span>
        </div>
        <div className="panel-body scroll">
          <div className="form-grid">
            <label>
              Name
              <input
                value={newSkill.name}
                onChange={(event) =>
                  setNewSkill((prev) => ({
                    ...prev,
                    name: event.target.value
                  }))
                }
                placeholder="skill-name"
              />
            </label>
            <label>
              Scope
              <select
                value={newSkill.scope}
                onChange={(event) =>
                  setNewSkill((prev) => ({
                    ...prev,
                    scope: event.target.value as SkillDraft["scope"]
                  }))
                }
              >
                <option value="user">User</option>
                <option value="repo">Repo</option>
              </select>
            </label>
            {newSkill.scope === "repo" ? (
              <label className="span-2">
                Repo root
                <input
                  value={newSkill.repo_root}
                  onChange={(event) =>
                    setNewSkill((prev) => ({
                      ...prev,
                      repo_root: event.target.value
                    }))
                  }
                  placeholder="D:\\projects\\myrepo"
                />
              </label>
            ) : null}
            <label className="span-2">
              Content
              <textarea
                value={newSkill.content}
                onChange={(event) =>
                  setNewSkill((prev) => ({
                    ...prev,
                    content: event.target.value
                  }))
                }
              />
            </label>
          </div>
        </div>
        <div className="panel-footer">
          <div className="panel-actions">
            <button
              className="primary"
              onClick={() =>
                void openPreview({
                  type: "create_skill",
                  scope: newSkill.scope,
                  repo_root: newSkill.repo_root || null,
                  name: newSkill.name,
                  content: newSkill.content
                })
              }
              disabled={!newSkill.name.trim()}
            >
              Preview create
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
