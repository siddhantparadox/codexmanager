import { useState } from "react";
import type { ChatMessage } from "../lib/types";

const PREVIEW_LIMIT = 180;

type ThinkingBlockProps = {
  message: ChatMessage;
};

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}…`;
}

function labelFor(message: ChatMessage) {
  const raw = message.subtype ?? "thinking";
  const cleaned = raw.replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export default function ThinkingBlock({ message }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const content = message.content ?? "";
  const preview = truncate(content, PREVIEW_LIMIT);

  if (!content.trim()) {
    return null;
  }

  return (
    <div className="thinking-block compact">
      <button
        type="button"
        className="thinking-toggle"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="thinking-label">{labelFor(message)}</span>
        <span className="thinking-preview">
          {open ? "Hide details" : preview || "Show details"}
        </span>
        <span className="thinking-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre className="thinking-body">{content || "No details available."}</pre>
      ) : null}
    </div>
  );
}
