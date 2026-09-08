import { describe, it, expect } from "vitest";
import { readSendMessage } from "./sendMessageInput.ts";

/** The shapes below are the ones actually present in local transcripts. */
describe("readSendMessage", () => {
  it("reads the canonical shape", () => {
    const f = readSendMessage({ to: "peer-a", summary: "s", message: "hello" });
    expect(f).toEqual({ to: "peer-a", summary: "s", body: "hello", bodyKey: "message", rest: {} });
  });

  it("prefers message when content duplicates it, and dumps neither", () => {
    const f = readSendMessage({ to: "peer-a", summary: "s", message: "hello", content: "hello", type: "message", recipient: "peer-a" });
    expect(f.bodyKey).toBe("message");
    expect(f.body).toBe("hello");
    expect(f.rest).toEqual({});
  });

  it("falls back to content, then to prompt", () => {
    expect(readSendMessage({ to: "a", content: "from content" })).toMatchObject({ body: "from content", bodyKey: "content" });
    expect(readSendMessage({ to: "a", prompt: "from prompt" })).toMatchObject({ body: "from prompt", bodyKey: "prompt" });
  });

  it("keeps a content that differs from message rather than hiding it", () => {
    const f = readSendMessage({ to: "a", message: "short", content: "the long one" });
    expect(f.body).toBe("short");
    expect(f.rest).toEqual({ content: "the long one" });
  });

  it("hands back every field it does not render", () => {
    const f = readSendMessage({ to: "a", summary: "s", content: "", notify_when_idle: "True", type: "message", recipient: "b" });
    // No body at all (content is empty) — and the empty key is not dumped.
    expect(f.body).toBeNull();
    expect(f.bodyKey).toBeNull();
    // recipient differs from `to`, so it is not the redundant echo: keep it.
    expect(f.rest).toEqual({ notify_when_idle: "True", recipient: "b" });
  });

  it("survives a shape it has never seen", () => {
    const f = readSendMessage({ payload: { nested: 1 }, count: 3 });
    expect(f).toMatchObject({ to: null, summary: null, body: null, bodyKey: null });
    expect(f.rest).toEqual({ payload: { nested: 1 }, count: 3 });
  });
});
