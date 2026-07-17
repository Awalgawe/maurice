import fs from "node:fs";
import readline from "node:readline";
import type { ContentBlock, InlineImage, TokenTotals } from "../../src/types.ts";

/** Async-iterate the parsed JSON objects of a .jsonl file, skipping bad lines. */
export async function* iterateJsonl(filePath: string): AsyncGenerator<any> {
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return;
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield obj;
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
}

/** Extract a TokenTotals from a message.usage object (server schema). */
export function tokensFromUsage(usage: any): TokenTotals {
  if (!usage) return emptyTokens();
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheCreate: usage.cache_creation_input_tokens || 0,
  };
}

/** Cache-write tokens split by TTL tier (usage.cache_creation). The two tiers
 *  are billed differently (5m ≈ 1.25× input, 1h ≈ 2× input). */
export interface CacheTierSplit {
  m5: number;
  h1: number;
}

/** Tier split of a usage's cache writes, or null when the log predates the
 *  cache_creation breakdown (pricing then falls back to the flat counter). */
export function cacheCreationSplit(usage: any): CacheTierSplit | null {
  const cc = usage?.cache_creation;
  if (!cc || typeof cc !== "object") return null;
  return {
    m5: cc.ephemeral_5m_input_tokens || 0,
    h1: cc.ephemeral_1h_input_tokens || 0,
  };
}

/** Context occupancy for a turn = everything fed in on the input side. */
export function contextTokens(usage: any): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

export function isMcpTool(name: string): boolean {
  return typeof name === "string" && name.startsWith("mcp__");
}

/** Normalize message.content (array or string) into renderable blocks. */
export function extractBlocks(message: any): ContentBlock[] {
  if (!message) return [];
  const content = message.content;
  if (typeof content === "string") {
    return content ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    switch (c.type) {
      case "text":
        if (c.text) blocks.push({ kind: "text", text: c.text });
        break;
      case "thinking":
        if (c.thinking) blocks.push({ kind: "thinking", text: c.thinking });
        break;
      case "tool_use":
        blocks.push({
          kind: "tool_use",
          name: c.name || "?",
          isMcp: isMcpTool(c.name || ""),
          input: c.input,
          id: c.id || null,
        });
        break;
      case "tool_result":
        blocks.push({
          kind: "tool_result",
          isError: c.is_error === true,
          text: stringifyToolResult(c.content),
          toolUseId: c.tool_use_id || null,
          images: extractInlineImages(c.content),
        });
        break;
      case "image": {
        const img = toInlineImage(c);
        if (img) blocks.push({ kind: "image", ...img });
        break;
      }
    }
  }
  return blocks;
}

export function stringifyToolResult(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      // Image sub-blocks are surfaced separately (see extractInlineImages); keep
      // their base64 payload out of the text so it isn't dumped as raw JSON.
      .filter((c) => !isImageBlock(c))
      .map((c) => (typeof c === "string" ? c : c?.text ?? JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(content);
}

function isImageBlock(c: any): boolean {
  return !!c && typeof c === "object" && c.type === "image";
}

/** Pull a base64 InlineImage out of an `image` content block, or null. */
function toInlineImage(c: any): InlineImage | null {
  if (!isImageBlock(c) || c.source?.type !== "base64" || !c.source.data) return null;
  return { mediaType: c.source.media_type || "image/png", data: c.source.data };
}

/** Base64 images embedded in a tool_result's content array (e.g. MCP screenshots). */
export function extractInlineImages(content: any): InlineImage[] {
  if (!Array.isArray(content)) return [];
  const images: InlineImage[] = [];
  for (const c of content) {
    const img = toInlineImage(c);
    if (img) images.push(img);
  }
  return images;
}
