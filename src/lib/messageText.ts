import type { ContentBlock, ThreadMessage } from "../types";

/** Readable tool name, matching the display normalization in Block.tsx. */
function toolName(name: string, isMcp: boolean): string {
  return isMcp ? name.replace(/^mcp__/, "mcp:") : name;
}

/** Render a tool_use input as readable `key: value` lines (strings verbatim, else JSON). */
function inputToText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  return entries
    .map(([k, v]) => {
      if (typeof v === "string") {
        // Multi-line values go on their own lines under the key.
        return v.includes("\n") ? `${k}:\n${v}` : `${k}: ${v}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
}

function blockToText(b: ContentBlock): string {
  switch (b.kind) {
    case "text":
    case "thinking":
      return b.text;
    case "tool_use": {
      const header = toolName(b.name, b.isMcp);
      const body = inputToText(b.input);
      return body ? `${header}\n${body}` : header;
    }
    case "tool_result":
      return b.text;
    case "image":
      return "";
  }
}

/**
 * Serialize a message's blocks to readable plain text (markdown, commands, tool
 * output) for copy-to-clipboard — no JSON structure, no UI chrome. Thinking blocks
 * are included even though the compact view hides them: they are message content.
 */
export function messageToText(m: ThreadMessage): string {
  return m.blocks.map(blockToText).join("\n\n");
}
