import { describe, it, expect } from "vitest";
import { extractBlocks } from "./jsonl.ts";

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
});
