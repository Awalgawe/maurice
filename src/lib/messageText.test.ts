import { describe, it, expect } from "vitest";
import type { ThreadMessage } from "../types";
import { messageToText } from "./messageText";

function msg(blocks: ThreadMessage["blocks"]): ThreadMessage {
  return {
    uuid: null,
    type: "assistant",
    role: "assistant",
    kind: "assistant",
    timestamp: null,
    model: null,
    skill: null,
    isSidechain: false,
    isError: false,
    tokens: null,
    blocks,
  };
}

describe("messageToText", () => {
  it("returns text and thinking verbatim", () => {
    expect(
      messageToText(msg([{ kind: "thinking", text: "let me think" }, { kind: "text", text: "# Hello\nworld" }])),
    ).toBe("let me think\n\n# Hello\nworld");
  });

  it("renders tool_use as name + readable key/value lines", () => {
    const out = messageToText(
      msg([{ kind: "tool_use", name: "Bash", isMcp: false, input: { command: "ls -la", description: "list" }, id: "x" }]),
    );
    expect(out).toBe("Bash\ncommand: ls -la\ndescription: list");
  });

  it("puts multi-line string values on their own lines and JSON-encodes non-strings", () => {
    const out = messageToText(
      msg([{ kind: "tool_use", name: "Edit", isMcp: false, input: { new_string: "line1\nline2", replace_all: true }, id: null }]),
    );
    expect(out).toBe("Edit\nnew_string:\nline1\nline2\nreplace_all: true");
  });

  it("normalizes mcp tool names", () => {
    const out = messageToText(
      msg([{ kind: "tool_use", name: "mcp__custom__ping", isMcp: true, input: {}, id: null }]),
    );
    expect(out).toBe("mcp:custom__ping");
  });

  it("renders tool_result text verbatim", () => {
    expect(messageToText(msg([{ kind: "tool_result", isError: false, text: "output here", toolUseId: null }]))).toBe(
      "output here",
    );
  });

  it("returns empty string for a message with no blocks", () => {
    expect(messageToText(msg([]))).toBe("");
  });
});
