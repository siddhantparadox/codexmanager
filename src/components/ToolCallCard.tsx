import { useState } from "react";
import type { ChatMessage } from "../lib/types";
import ChatMarkdown from "./ChatMarkdown";

const PREVIEW_LIMIT = 200;

type ToolCallCardProps = {
  message: ChatMessage;
};

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}…`;
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isEmptyPayload(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return true;
  const parsed = tryParseJson(trimmed);
  if (parsed === null) return false;
  if (parsed === null || parsed === undefined) return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed === "object") return Object.keys(parsed as Record<string, unknown>).length === 0;
  if (typeof parsed === "string") return parsed.trim().length === 0;
  return false;
}

function summarizeJson(value: unknown) {
  if (value === null || value === undefined) return "empty";
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "object(0)";
    const sample = keys.slice(0, 4).join(", ");
    return keys.length > 4 ? `keys: ${sample}…` : `keys: ${sample}`;
  }
  if (typeof value === "string") {
    return truncate(value, PREVIEW_LIMIT);
  }
  return String(value);
}

function formatJson(value: string) {
  const parsed = tryParseJson(value);
  if (parsed === null) return null;
  return {
    parsed,
    pretty: JSON.stringify(parsed, null, 2)
  };
}

function labelFor(message: ChatMessage) {
  if (message.tool_name) return message.tool_name;
  if (message.subtype) return message.subtype.replace(/_/g, " ");
  return "Tool";
}

function badgeFor(message: ChatMessage) {
  if (!message.subtype) return null;
  const lower = message.subtype.toLowerCase();
  if (lower.includes("output")) return "Output";
  if (lower.includes("call")) return "Call";
  return null;
}

export default function ToolCallCard({ message }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const content = message.content ?? "";
  const badge = badgeFor(message);
  const formatted = formatJson(content);
  const summary = formatted ? summarizeJson(formatted.parsed) : truncate(content, PREVIEW_LIMIT);
  const previewLabel =
    badge === "Call" ? "Arguments" : badge === "Output" ? "Output" : "Details";
  const previewText = summary ? `${previewLabel}: ${summary}` : `Show ${previewLabel}`;
  const payloadIsEmpty = isEmptyPayload(content);
  const hasStatus = Boolean(message.tool_status);

  if (payloadIsEmpty && !hasStatus) {
    return null;
  }

  return (
    <div className="tool-card compact">
      <button
        type="button"
        className="tool-header"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="tool-title">
          <span className="tool-name">{labelFor(message)}</span>
          {badge ? <span className="tool-badge">{badge}</span> : null}
          {message.tool_call_id ? (
            <span className="tool-id">#{message.tool_call_id}</span>
          ) : null}
          {message.tool_status ? (
            <span className="tool-status">{message.tool_status}</span>
          ) : null}
        </div>
        <span className="tool-preview">
          {open ? "Hide details" : previewText || "Show details"}
        </span>
        <span className="tool-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        formatted ? (
          <pre className="tool-body">{formatted.pretty}</pre>
        ) : (
          <div className="tool-body markdown">
            {content ? <ChatMarkdown content={content} /> : "No details available."}
          </div>
        )
      ) : null}
    </div>
  );
}
