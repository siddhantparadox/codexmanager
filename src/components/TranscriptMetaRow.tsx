import { useState } from "react";
import type { ChatMessage } from "../lib/types";

const PREVIEW_LIMIT = 160;

type TranscriptMetaRowProps = {
  message: ChatMessage;
  label?: string;
};

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}…`;
}

function defaultLabel(message: ChatMessage) {
  if (message.kind === "developer") return "Developer";
  if (message.subtype) return `Meta: ${message.subtype.replace(/_/g, " ")}`;
  return "Meta";
}

export default function TranscriptMetaRow({ message, label }: TranscriptMetaRowProps) {
  const [open, setOpen] = useState(false);
  const content = message.content ?? "";
  const preview = truncate(content, PREVIEW_LIMIT);

  if (!content.trim()) {
    return null;
  }

  return (
    <div className="meta-row compact">
      <button
        type="button"
        className="meta-toggle"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="meta-label">{label ?? defaultLabel(message)}</span>
        <span className="meta-preview">
          {open ? "Hide details" : preview || "Show details"}
        </span>
        <span className="meta-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre className="meta-body">{content || "No details available."}</pre>
      ) : null}
    </div>
  );
}
