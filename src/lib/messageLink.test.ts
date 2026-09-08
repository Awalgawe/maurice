import { describe, expect, it } from "vitest";
import { DETAIL_PAGE, messageLink } from "./messageLink";

describe("messageLink", () => {
  it("omits ?page for the first page", () => {
    expect(messageLink("s1", { uuid: "u1", index: 0 })).toBe("/sessions/s1#msg-u1");
    expect(messageLink("s1", { uuid: "u1", index: DETAIL_PAGE - 1 })).toBe("/sessions/s1#msg-u1");
  });

  it("lands on the page the detail actually serves the message on", () => {
    expect(messageLink("s1", { uuid: "u1", index: DETAIL_PAGE })).toBe("/sessions/s1?page=2#msg-u1");
    expect(messageLink("s1", { uuid: "u1", index: DETAIL_PAGE * 3 + 5 })).toBe("/sessions/s1?page=4#msg-u1");
  });

  it("selects the abandoned branch that owns the message", () => {
    expect(messageLink("s1", { uuid: "u1", index: 0, branch: "f2" })).toBe("/sessions/s1?branch=f2#msg-u1");
    expect(messageLink("s1", { uuid: "u1", index: DETAIL_PAGE, fork: "f1" })).toBe(
      "/sessions/s1?page=2&branch=f1#msg-u1",
    );
  });

  it("returns null rather than a link that cannot land on its target", () => {
    expect(messageLink("s1", { uuid: null, index: 42 })).toBeNull();
  });
});
