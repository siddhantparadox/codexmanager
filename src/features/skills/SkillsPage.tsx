import { useState } from "react";
import { readSkillText } from "../../lib/api";
import { normalizeError } from "../../lib/errors";
import type { SkillSummary } from "../../lib/types";
import { useAppState } from "../../store/appStore";

type SkillDraft = {
  name: string;
  scope: "user" | "repo";
  repo_root: string;
  content: string;
};

const NEW_SKILL_TEMPLATE = `---\nname: New Skill\ndescription: Short description\n---\n\n# New Skill\nDescribe behavior here.\n`;

export default function SkillsPage() {
  const { scan, openPreview, setBusy, setError } = useAppState();
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [skillText, setSkillText] = useState<string>("");
  const [newSkill, setNewSkill] = useState<SkillDraft>({
    name: "",
    scope: "user",
    repo_root: "",
    content: NEW_SKILL_TEMPLATE
  });

  async function handleSkillSelect(skill: SkillSummary) {
    setSelectedSkill(skill);
    setSkillText("");
    setBusy(true);
    setError(null);
    try {
      const text = await readSkillText(skill.path);
      setSkillText(text);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="split">
      <div className="panel">
        <div className="panel-header">
          <h2>Skills</h2>
          <span className="panel-meta">User + repo layers</span>
        </div>
        <div className="list">
          {scan?.skills.map((skill) => (
            <button
              key={skill.path}
              className={`list-item ${selectedSkill?.path === skill.path ? "active" : ""}`}
              onClick={() => handleSkillSelect(skill)}
            >
              <div>
                <p className="row-title">{skill.name}</p>
                <p className="row-meta">{skill.scope}</p>
              </div>
              <span className="list-path">{skill.path}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Editor</h2>
          <span className="panel-meta">
            {selectedSkill ? selectedSkill.name : "Select a skill"}
          </span>
        </div>
        {selectedSkill ? (
          <>
            <textarea
              className="editor"
              value={skillText}
              onChange={(event) => setSkillText(event.target.value)}
            />
            <div className="panel-actions">
              <button
                className="primary"
                onClick={() =>
                  void openPreview({
                    type: "update_skill",
                    path: selectedSkill.path,
                    content: skillText
                  })
                }
              >
                Preview save
              </button>
              <button
                className="ghost-button"
                onClick={() =>
                  void openPreview({
                    type: "delete_skill",
                    path: selectedSkill.path
                  })
                }
              >
                Preview delete
              </button>
            </div>
          </>
        ) : (
          <p className="ghost">Select a skill to edit.</p>
        )}
      </div>
      <div className="panel span-full">
        <div className="panel-header">
          <h2>Create skill</h2>
          <span className="panel-meta">Templates are editable</span>
        </div>
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
    </section>
  );
}
