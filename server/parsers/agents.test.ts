import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// agents.ts (dynamic import in beforeAll, mirroring subagents.test.ts).
let dir: string;
let parseAgentFrontmatter: typeof import("./agents.ts").parseAgentFrontmatter;
let listDefinedAgents: typeof import("./agents.ts").listDefinedAgents;
let classifyAgentType: typeof import("./agents.ts").classifyAgentType;

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join((process.env.TMPDIR || "/tmp").replace(/\/+$/, ""), "maurice-agents-"));
  process.env.CLAUDE_DIR = dir;
  ({ parseAgentFrontmatter, listDefinedAgents, classifyAgentType } = await import("./agents.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("parseAgentFrontmatter", () => {
  it("parses a complete frontmatter block with a comma-separated tools string", () => {
    const content = [
      "---",
      "name: jira-manager",
      "description: >-",
      "  Handles all JIRA operations on webedia-group. Line two of the",
      "  folded description.",
      "tools: Read, Grep, mcp__foo__bar",
      "model: sonnet",
      "color: blue",
      "---",
      "",
      "Body content, not parsed.",
    ].join("\n");
    const fm = parseAgentFrontmatter(content)!;
    expect(fm.name).toBe("jira-manager");
    expect(fm.description).toBe(
      "Handles all JIRA operations on webedia-group. Line two of the folded description.",
    );
    expect(fm.tools).toEqual(["Read", "Grep", "mcp__foo__bar"]);
    expect(fm.model).toBe("sonnet");
    expect(fm.color).toBe("blue");
  });

  it("parses a minimal frontmatter block (name + single-line description only)", () => {
    const content = ["---", "name: mini", "description: A short description.", "---", ""].join("\n");
    const fm = parseAgentFrontmatter(content)!;
    expect(fm).toEqual({ name: "mini", description: "A short description.", model: null, color: null, tools: null });
  });

  it("parses a JSON-array-style tools value and strips brackets/quotes", () => {
    const content = ["---", "name: x", 'tools: ["Read", "Edit"]', "---", ""].join("\n");
    const fm = parseAgentFrontmatter(content)!;
    expect(fm.tools).toEqual(["Read", "Edit"]);
  });

  it("returns null for malformed frontmatter (no closing delimiter, or no name)", () => {
    expect(parseAgentFrontmatter("no frontmatter here")).toBeNull();
    expect(parseAgentFrontmatter(["---", "description: orphan, no name", "---", ""].join("\n"))).toBeNull();
  });
});

describe("listDefinedAgents", () => {
  it("scans the user registry (~/.claude/agents)", async () => {
    write(path.join(dir, "agents", "my-agent.md"), ["---", "name: my-agent", "description: d", "---", ""].join("\n"));
    const agents = listDefinedAgents([]);
    const found = agents.find((a) => a.name === "my-agent")!;
    expect(found.source).toBe("user");
    expect(found.projectId).toBeNull();
  });

  it("scans a project registry from the index's projectPath, deduping repeated sessions of the same project", () => {
    const projectPath = path.join(dir, "proj-a");
    write(
      path.join(projectPath, ".claude", "agents", "proj-agent.md"),
      ["---", "name: proj-agent", "description: d", "---", ""].join("\n"),
    );
    const index = [
      { projectPath, projectId: "p1", projectLabel: "proj-a" },
      { projectPath, projectId: "p1", projectLabel: "proj-a" }, // same project, two sessions
    ] as unknown as import("../../src/types.ts").SessionMeta[];
    const agents = listDefinedAgents(index);
    const matches = agents.filter((a) => a.name === "proj-agent");
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe("project");
    expect(matches[0].projectId).toBe("p1");
  });

  it("ignores a project whose projectPath no longer exists on disk", () => {
    const index = [
      { projectPath: path.join(dir, "gone"), projectId: "p2", projectLabel: "gone" },
    ] as unknown as import("../../src/types.ts").SessionMeta[];
    expect(() => listDefinedAgents(index)).not.toThrow();
  });

  it("scans plugin agents from plugins/cache/<marketplace>/<plugin>/<version>/agents, namespaced plugin:name", () => {
    write(
      path.join(dir, "plugins", "cache", "webedia", "wbd-jira", "1.0.0", "agents", "jira-manager.md"),
      ["---", "name: jira-manager", "description: d", "---", ""].join("\n"),
    );
    const agents = listDefinedAgents([]);
    const found = agents.find((a) => a.name === "wbd-jira:jira-manager")!;
    expect(found).toBeTruthy();
    expect(found.source).toBe("plugin");
  });

  it("skips a malformed agent file without throwing", () => {
    write(path.join(dir, "agents", "broken.md"), "not frontmatter at all");
    expect(() => listDefinedAgents([])).not.toThrow();
    const agents = listDefinedAgents([]);
    expect(agents.some((a) => a.filePath.endsWith("broken.md"))).toBe(false);
  });
});

describe("classifyAgentType", () => {
  const registry = [
    { name: "my-custom-agent", source: "user" } as any,
    { name: "proj-agent", source: "project" } as any,
    { name: "wbd-jira:jira-manager", source: "plugin" } as any,
  ];

  it("classifies a namespaced name as plugin", () => {
    expect(classifyAgentType("wbd-jira:jira-manager", registry)).toBe("plugin");
  });

  it("classifies a name found in the user/project registry as custom", () => {
    expect(classifyAgentType("my-custom-agent", registry)).toBe("custom");
    expect(classifyAgentType("proj-agent", registry)).toBe("custom");
  });

  it("classifies a known Claude Code agentType as builtin", () => {
    expect(classifyAgentType("Explore", registry)).toBe("builtin");
    expect(classifyAgentType("general-purpose", [])).toBe("builtin");
  });

  it("classifies anything else as unknown", () => {
    expect(classifyAgentType("totally-made-up", registry)).toBe("unknown");
  });
});
