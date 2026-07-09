import { describe, expect, it } from "vitest";
import { createForkCollector } from "./forks.ts";

/** Build a minimal JSONL line object. */
function line(
  uuid: string,
  parent: string | null,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { uuid, parentUuid: parent, type, timestamp: `2026-07-09T10:00:00Z`, ...extra };
}

const human = (uuid: string, parent: string | null, text: string) =>
  line(uuid, parent, "user", { message: { role: "user", content: text } });

const assistantText = (uuid: string, parent: string | null, requestId: string) =>
  line(uuid, parent, "assistant", {
    requestId,
    message: { id: `msg_${requestId}`, role: "assistant", content: [{ type: "text", text: "ok" }] },
  });

const assistantTool = (uuid: string, parent: string | null, requestId: string, toolId: string) =>
  line(uuid, parent, "assistant", {
    requestId,
    message: { id: `msg_${requestId}`, role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Bash", input: {} }] },
  });

const toolResult = (uuid: string, parent: string | null, toolId: string) =>
  line(uuid, parent, "user", {
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "done" }] },
  });

function analyze(objs: Record<string, unknown>[]) {
  const c = createForkCollector();
  for (const o of objs) c.add(o);
  return c.finish();
}

describe("createForkCollector", () => {
  it("keeps a linear thread fully active with no forks", () => {
    const a = analyze([
      human("u1", null, "hello"),
      assistantText("a1", "u1", "r1"),
      human("u2", "a1", "next"),
      assistantText("a2", "u2", "r2"),
    ]);
    expect(a.forks).toEqual([]);
    for (const id of ["u1", "a1", "u2", "a2"]) expect(a.forkOf(id)).toBeNull();
    expect(a.viewMembers(null)).toEqual(new Set(["u1", "a1", "u2", "a2"]));
  });

  it("does not flag parallel tool-call siblings as forks (same requestId)", () => {
    // Real shape (session 27d0170a): assistant turn with 2 tool_use lines; the
    // 2nd tool_use line and the 1st tool_result both fork off the 1st line.
    const a = analyze([
      human("u1", null, "do two things"),
      assistantTool("a1", "u1", "r1", "t1"),
      assistantTool("a2", "a1", "r1", "t2"), // same turn, same requestId
      toolResult("tr1", "a1", "t1"), // forks off a1, dead end in the tree
      toolResult("tr2", "tr1", "t2"),
      assistantText("a3", "tr2", "r2"),
    ]);
    expect(a.forks).toEqual([]);
    for (const id of ["u1", "a1", "a2", "tr1", "tr2", "a3"]) expect(a.forkOf(id)).toBeNull();
  });

  it("detects a rewind fork and assigns the earlier branch to f1", () => {
    // Real shape (session 30170c85): prompt retry "Codexe" → "Codex".
    const a = analyze([
      human("u1", null, "start"),
      assistantText("a1", "u1", "r1"),
      human("u2a", "a1", "review with Codexe please"), // abandoned attempt
      assistantText("a2a", "u2a", "r2"),
      human("u2b", "a1", "review with Codex please"), // the redo
      assistantText("a2b", "u2b", "r3"),
    ]);
    expect(a.forks).toHaveLength(1);
    const f = a.forks[0];
    expect(f.ref).toBe("f1");
    expect(f.forkPointUuid).toBe("a1");
    expect(f.messageCount).toBe(2);
    expect(f.preview).toContain("Codexe");
    // a1 sits at index 1 in both views ([u1, a1, …]).
    expect(f.forkPointIndex).toBe(1);
    expect(f.forkPointIndexLive).toBe(1);
    expect(a.forkOf("u2a")).toBe("f1");
    expect(a.forkOf("a2a")).toBe("f1");
    expect(a.forkOf("u2b")).toBeNull();
    expect(a.forkOf("a2b")).toBeNull();
    expect(a.forksAt("a1")).toEqual(["f1"]);
    // Fork view = shared prefix + own subtree.
    expect(a.viewMembers("f1")).toEqual(new Set(["u1", "a1", "u2a", "a2a"]));
    expect(a.viewMembers(null)).toEqual(new Set(["u1", "a1", "u2b", "a2b"]));
    expect(a.viewMembers("nope")).toBeNull();
  });

  it("treats empty-string parentUuid as a root without crashing", () => {
    const a = analyze([
      line("u1", null, "user", { message: { role: "user", content: "hi" }, parentUuid: "" }),
      assistantText("a1", "u1", "r1"),
    ]);
    expect(a.forks).toEqual([]);
    expect(a.forkOf("u1")).toBeNull();
  });

  it("keeps disconnected segments (compaction) on the live thread", () => {
    const a = analyze([
      human("u1", null, "before compaction"),
      assistantText("a1", "u1", "r1"),
      human("u2", null, "after compaction"), // new root, no link to u1/a1
      assistantText("a2", "u2", "r2"),
    ]);
    expect(a.forks).toEqual([]);
    for (const id of ["u1", "a1", "u2", "a2"]) expect(a.forkOf(id)).toBeNull();
    expect(a.viewMembers(null)).toEqual(new Set(["u1", "a1", "u2", "a2"]));
  });

  it("gives nested rewinds distinct refs with correct views", () => {
    const a = analyze([
      human("u1", null, "start"),
      assistantText("a1", "u1", "r1"),
      human("u2a", "a1", "first try"), // f1 subtree root
      assistantText("a2a", "u2a", "r2"),
      human("u3a", "a2a", "nested first try"), // f2: rewind inside f1
      assistantText("a3a", "u3a", "r3"),
      human("u3b", "a2a", "nested second try"), // f1's own tip path
      assistantText("a3b", "u3b", "r4"),
      human("u2b", "a1", "second try"), // live thread
      assistantText("a2b", "u2b", "r5"),
    ]);
    expect(a.forks.map((f) => f.ref)).toEqual(["f1", "f2"]);
    expect(a.forkOf("u2b")).toBeNull();
    expect(a.forkOf("u2a")).toBe("f1");
    expect(a.forkOf("u3b")).toBe("f1"); // f1's view is tipped at its LAST line
    expect(a.forkOf("u3a")).toBe("f2");
    const f2 = a.forks.find((f) => f.ref === "f2")!;
    expect(f2.forkPointUuid).toBe("a2a");
    expect(a.viewMembers("f2")).toEqual(new Set(["u1", "a1", "u2a", "a2a", "u3a", "a3a"]));
    expect(a.viewMembers("f1")).toEqual(new Set(["u1", "a1", "u2a", "a2a", "u3b", "a3b"]));
    // f2's point (a2a) is at index 3 of its own view; not live, so the live
    // index just counts the live turns before it (u1, a1 → 2).
    expect(f2.forkPointIndex).toBe(3);
    expect(f2.forkPointIndexLive).toBe(2);
  });

  it("attaches parallel tool_results of an abandoned turn to that fork", () => {
    const a = analyze([
      human("u1", null, "go"),
      assistantText("a1", "u1", "r1"),
      human("u2a", "a1", "old branch"),
      assistantTool("a2a", "u2a", "r2", "t1"),
      assistantTool("a2b", "a2a", "r2", "t2"),
      toolResult("tr1", "a2a", "t1"),
      toolResult("tr2", "tr1", "t2"),
      human("u2b", "a1", "new branch"),
      assistantText("a2c", "u2b", "r3"),
    ]);
    expect(a.forks).toHaveLength(1);
    for (const id of ["u2a", "a2a", "a2b", "tr1", "tr2"]) expect(a.forkOf(id)).toBe("f1");
    for (const id of ["u1", "a1", "u2b", "a2c"]) expect(a.forkOf(id)).toBeNull();
    expect(a.forks[0].messageCount).toBe(5);
  });
});
