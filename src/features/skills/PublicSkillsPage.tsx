import { useEffect, useMemo, useState } from "react";
import { fetchPublicSkill, listPublicSkills } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import { openExternal } from "../../lib/openExternal";
import type { InstallMode, RemoteSkillDetail, RemoteSkillSummary } from "../../lib/types";
import { useAppState } from "../../store/appStore";

const CLAWDHUB_BROWSE_URL = "https://clawdhub.com";

const MODE_HELP: Record<InstallMode, string> = {
  overlay: "Overlay (safe) only adds or overwrites files from the package.",
  replace: "Replace removes the existing skill folder before installing.",
  sync: "Sync deletes local files that are not in the package. Preview required."
};

export default function PublicSkillsPage() {
  const { scan, openPreview, setBusy, setError } = useAppState();
  const [skills, setSkills] = useState<RemoteSkillSummary[]>([]);
  const [selected, setSelected] = useState<RemoteSkillSummary | null>(null);
  const [detail, setDetail] = useState<RemoteSkillDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [mode, setMode] = useState<InstallMode>("overlay");
  const [scope, setScope] = useState<"user" | "repo">("user");
  const [repoRoot, setRepoRoot] = useState("");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const pageSize = 10;

  const repoRoots = scan?.settings.repo_roots ?? [];
  const canInstall =
    !!detail && (scope === "user" || (scope === "repo" && repoRoot.trim().length > 0));

  useEffect(() => {
    if (scope === "repo" && !repoRoot && repoRoots.length > 0) {
      setRepoRoot(repoRoots[0]);
    }
  }, [scope, repoRoot, repoRoots]);

  const modeHelp = useMemo(() => MODE_HELP[mode], [mode]);
  const modeClass =
    mode === "sync" || mode === "replace" ? "card-warning" : "row-meta";

  async function loadSkills(
    search?: string,
    cursor?: string | null,
    append?: boolean
  ) {
    setBusy(true);
    setError(null);
    try {
      const page = await listPublicSkills(search, cursor, pageSize);
      setSkills((prev) => {
        const next = append ? [...prev, ...page.items] : page.items;
        const seen = new Set<string>();
        return next.filter((item) => {
          if (seen.has(item.slug)) {
            return false;
          }
          seen.add(item.slug);
          return true;
        });
      });
      setNextCursor(page.next_cursor ?? null);
      if (selected && !append) {
        const match = page.items.find((item) => item.slug === selected.slug) ?? null;
        setSelected(match);
        if (!match) {
          setDetail(null);
        }
      }
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(skill: RemoteSkillSummary) {
    setSelected(skill);
    setDetail(null);
    setExpanded(false);
    setShowFiles(false);
    setBusy(true);
    setError(null);
    try {
      const data = await fetchPublicSkill(skill.slug);
      setDetail(data);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setNextCursor(null);
      void loadSkills(query.trim(), null, false);
    }, query.trim() ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <section className="split">
      <div className="panel panel-scroll">
        <div className="panel-header">
          <h2>Public Skills</h2>
          <span className="panel-meta">ClawdHub registry</span>
        </div>
        <div className="panel-tools">
          <div className="filter-bar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, slug, or tag"
            />
            <button
              className="ghost-button"
              onClick={() => void loadSkills(query.trim(), null, false)}
            >
              Refresh
            </button>
            <button
              className="ghost-button"
              onClick={() => void openExternal(CLAWDHUB_BROWSE_URL)}
            >
              Browse ClawdHub
            </button>
          </div>
        </div>
        <div className="panel-body">
          {skills.length === 0 ? (
            <p className="ghost">No public skills found.</p>
          ) : (
            <>
              <div className="list public-skills-list">
                {skills.map((skill) => (
                  <button
                    key={skill.slug}
                    className={`list-item ${selected?.slug === skill.slug ? "active" : ""}`}
                    onClick={() => handleSelect(skill)}
                  >
                    <div className="list-row">
                      <div className="row-body">
                        <p className="row-title">{skill.name}</p>
                        {skill.tags.length ? (
                          <div className="count-pills">
                            {skill.tags.map((tag) => (
                              <span key={tag} className="pill">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="row-meta">No tags</p>
                        )}
                      </div>
                      <div className="row-actions">
                        <span className="badge info">Public</span>
                      </div>
                    </div>
                    <span className="list-path">{skill.slug}</span>
                  </button>
                ))}
              </div>
              {nextCursor ? (
                <button
                  className="ghost-button load-more"
                  onClick={async () => {
                    if (loadingMore) return;
                    setLoadingMore(true);
                    await loadSkills(query.trim(), nextCursor, true);
                    setLoadingMore(false);
                  }}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="panel panel-scroll">
        <div className="panel-header">
          <h2>Details</h2>
          <span className="panel-meta">{selected ? selected.name : "Select a skill"}</span>
        </div>
        {selected ? (
          <>
            <div className="panel-body public-skills-detail">
              {detail ? (
                <>
                  <p className="row-meta">{detail.slug}</p>
                  {detail.description ? (
                    <p className="panel-note">{detail.description}</p>
                  ) : null}
                  {detail.tags.length ? (
                    <div className="count-pills">
                      {detail.tags.map((tag) => (
                        <span key={tag} className="pill">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {detail.source_url ? (
                    <a
                      className="row-link"
                      href={detail.source_url}
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(detail.source_url ?? "");
                      }}
                    >
                      {detail.source_url}
                    </a>
                  ) : null}
                  {detail.skill_md ? (
                    <div className="library-item">
                      <div className="row library-row">
                        <div className="row-body">
                          <p className="row-title">SKILL.md</p>
                          <p className="row-meta">Preview the skill instructions before install.</p>
                        </div>
                        <div className="row-actions">
                          <button
                            className="ghost-button"
                            onClick={() => setExpanded((prev) => !prev)}
                          >
                            {expanded ? "Hide" : "View"}
                          </button>
                        </div>
                      </div>
                      {expanded ? <pre className="code-block">{detail.skill_md}</pre> : null}
                    </div>
                  ) : (
                    <p className="row-meta">SKILL.md not available via the registry response.</p>
                  )}
                  {detail.files.length ? (
                    <div className="library-item">
                      <div className="row library-row">
                        <div className="row-body">
                          <p className="row-title">Files</p>
                          <p className="row-meta">{detail.files.length} files in package</p>
                        </div>
                        <div className="row-actions">
                          <button
                            className="ghost-button"
                            onClick={() => setShowFiles((prev) => !prev)}
                          >
                            {showFiles ? "Hide" : "View"}
                          </button>
                        </div>
                      </div>
                      {showFiles ? (
                        <div className="file-list">
                          {detail.files.map((file) => (
                            <span key={file} className="file-pill">
                              {file}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="ghost">Loading skill details…</p>
              )}
            </div>
            <div className="panel-footer">
              <div className="form-grid compact">
                <label>
                  Scope
                  <select
                    value={scope}
                    onChange={(event) => setScope(event.target.value as "user" | "repo")}
                  >
                    <option value="user">User</option>
                    <option value="repo">Repo</option>
                  </select>
                </label>
                {scope === "repo" ? (
                  repoRoots.length ? (
                    <label>
                      Repo root
                      <select
                        value={repoRoot}
                        onChange={(event) => setRepoRoot(event.target.value)}
                      >
                        {repoRoots.map((root) => (
                          <option key={root} value={root}>
                            {root}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Repo root
                      <input
                        value={repoRoot}
                        onChange={(event) => setRepoRoot(event.target.value)}
                        placeholder="D:\\projects\\myrepo"
                      />
                    </label>
                  )
                ) : null}
                <label className={scope === "repo" ? "span-2" : undefined}>
                  Install mode
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as InstallMode)}
                  >
                    <option value="overlay">Overlay (safe)</option>
                    <option value="replace">Replace (clean install)</option>
                    <option value="sync">Sync (exact match)</option>
                  </select>
                </label>
                <p className={`${modeClass} ${scope === "repo" ? "span-2" : ""}`}>
                  {modeHelp}
                </p>
              </div>
              <div className="panel-actions">
                <button
                  className="primary"
                  onClick={() =>
                    detail
                      ? void openPreview({
                          type: "install_remote_skill",
                          slug: detail.slug,
                          scope,
                          repo_root: scope === "repo" ? repoRoot || null : null,
                          mode
                        })
                      : undefined
                  }
                  disabled={!canInstall}
                >
                  Preview install
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="ghost">Select a public skill to view details.</p>
        )}
      </div>
    </section>
  );
}
