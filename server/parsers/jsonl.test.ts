import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheCreationSplit, extractBlocks, iterateJsonl, stringifyToolResult } from "./jsonl.ts";

async function collect(filePath: string): Promise<any[]> {
  const out: any[] = [];
  for await (const obj of iterateJsonl(filePath)) out.push(obj);
  return out;
}

describe("extractBlocks", () => {
  it("keeps a base64 image block with its media type", () => {
    const blocks = extractBlocks({
      content: [
        { type: "text", text: "look at this" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    });
    expect(blocks).toEqual([
      { kind: "text", text: "look at this" },
      { kind: "image", mediaType: "image/png", data: "AAAA" },
    ]);
  });

  it("defaults the media type when missing", () => {
    const blocks = extractBlocks({
      content: [{ type: "image", source: { type: "base64", data: "AAAA" } }],
    });
    expect(blocks).toEqual([{ kind: "image", mediaType: "image/png", data: "AAAA" }]);
  });

  it("drops an image block with no base64 data", () => {
    const blocks = extractBlocks({
      content: [{ type: "image", source: { type: "url", url: "https://example.com/x.png" } }],
    });
    expect(blocks).toEqual([]);
  });

  it("surfaces base64 images embedded in a tool_result (e.g. MCP screenshots)", () => {
    const blocks = extractBlocks({
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "text", text: "Took a screenshot." },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
        },
      ],
    });
    expect(blocks).toEqual([
      {
        kind: "tool_result",
        isError: false,
        text: "Took a screenshot.",
        toolUseId: "toolu_1",
        images: [{ mediaType: "image/png", data: "AAAA" }],
      },
    ]);
  });

  it("keeps base64 image payloads out of the tool_result text", () => {
    const text = stringifyToolResult([
      { type: "text", text: "before" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "HUGEBASE64" } },
      { type: "text", text: "after" },
    ]);
    expect(text).toBe("before\nafter");
    expect(text).not.toContain("HUGEBASE64");
  });
});

describe("iterateJsonl", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maurice-jsonl-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("yields parsed objects, skipping blank and malformed lines", async () => {
    const file = path.join(dir, "a.jsonl");
    fs.writeFileSync(file, ['{"a":1}', "", "  ", "not json", '{"b":2}', ""].join("\n"));
    expect(await collect(file)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("yields nothing (no throw) when the file vanished before reading (async ENOENT)", async () => {
    // createReadStream doesn't throw synchronously for a missing path; the ENOENT
    // surfaces asynchronously during iteration — this is the regression guard.
    const gone = path.join(dir, "vanished.jsonl");
    expect(await collect(gone)).toEqual([]);
  });

  it("propagates a non-ENOENT read error instead of masking it as empty", async () => {
    // Reading a directory emits EISDIR asynchronously — must not be swallowed.
    await expect(collect(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("cacheCreationSplit", () => {
  it("extracts the 5m/1h tier split from usage.cache_creation", () => {
    const usage = {
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 700 },
    };
    expect(cacheCreationSplit(usage)).toEqual({ m5: 300, h1: 700 });
  });

  it("returns null when the log predates the breakdown", () => {
    expect(cacheCreationSplit({ cache_creation_input_tokens: 1000 })).toBeNull();
    expect(cacheCreationSplit(undefined)).toBeNull();
    expect(cacheCreationSplit({})).toBeNull();
  });
});
