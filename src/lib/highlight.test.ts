import { describe, it, expect } from "vitest";
import { highlightCode } from "./highlight";

// highlightCode output flows into dangerouslySetInnerHTML; it must never hand
// back raw markup. Either it returns null (caller lets React escape the text)
// or HTML in which the angle brackets are already entity-escaped.
describe("highlightCode XSS safety", () => {
  it("never returns raw markup for an unhighlightable payload", () => {
    const out = highlightCode("<img src=x onerror=alert(1)>");
    expect(out === null || !out.includes("<img")).toBe(true);
  });

  it("escapes angle brackets when highlighting with an explicit language", () => {
    const out = highlightCode('{"x": "<img src=x onerror=alert(1)>"}', "json");
    expect(out).not.toBeNull();
    expect(out as string).not.toContain("<img");
    expect(out as string).toContain("&lt;img");
  });
});
