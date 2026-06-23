import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./memory.ts";

describe("parseFrontmatter", () => {
  it("extracts name, description, nested type and body", () => {
    const md = [
      "---",
      "name: my-fact",
      "description: a one-liner",
      "metadata:",
      "  type: feedback",
      "---",
      "The body text.",
    ].join("\n");
    const out = parseFrontmatter(md);
    expect(out).toMatchObject({
      name: "my-fact",
      description: "a one-liner",
      type: "feedback",
      body: "The body text.",
    });
    expect(out?.originSessionId).toBeUndefined();
  });

  it("captures originSessionId when present", () => {
    const md = [
      "---",
      "name: linked",
      "description: d",
      "metadata:",
      "  type: project",
      "  originSessionId: abc-123",
      "---",
      "body",
    ].join("\n");
    expect(parseFrontmatter(md)?.originSessionId).toBe("abc-123");
  });

  it("strips wrapping quotes from values", () => {
    const md = '---\nname: "quoted"\ndescription: \'single\'\n---\nb';
    const out = parseFrontmatter(md);
    expect(out?.name).toBe("quoted");
    expect(out?.description).toBe("single");
  });

  it("returns null when there is no frontmatter block", () => {
    expect(parseFrontmatter("just text, no dashes")).toBeNull();
  });
});
