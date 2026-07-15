import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";

// Isolate from the real ~/.claude: throwaway CLAUDE_DIR (bound before api.ts
// imports agents.ts) and a stubbed session index (registry + usage join must
// not depend on the real machine's history).
vi.hoisted(() => {
  process.env.CLAUDE_DIR =
    (process.env.TMPDIR || "/tmp").replace(/\/+$/, "") + "/maurice-agents-route-" + process.pid + "/.claude";
});
const ROOT = process.env.CLAUDE_DIR as string;

const state = vi.hoisted(() => ({ index: [] as any[] }));
vi.mock("../cache.ts", () => ({ getIndex: async () => state.index }));

import { api } from "./api.ts";

const HOME = path.dirname(ROOT);
const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

let server: http.Server;
let base: string;

beforeAll(async () => {
  fs.mkdirSync(path.join(ROOT, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "agents", "my-custom-agent.md"),
    ["---", "name: my-custom-agent", "description: A custom agent, never used.", "---", ""].join("\n"),
  );
  const app = express();
  app.use("/api", api);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe("GET /api/agents", () => {
  it("joins registry and usage by name, surfacing both kinds of orphan", async () => {
    state.index = [
      {
        projectPath: null,
        end: "2026-07-10T10:00:00Z",
        subagentsByType: {
          Explore: { count: 3, costUSD: 0.5, tokens: emptyTokens() },
          "totally-unused-agent-type": { count: 1, costUSD: 0.1, tokens: emptyTokens() },
        },
      },
    ];
    const r = await fetch(`${base}/api/agents`);
    expect(r.status).toBe(200);
    const { agents } = (await r.json()) as { agents: any[] };

    // defined-never-used: has a definition, no usage.
    const custom = agents.find((a) => a.name === "my-custom-agent")!;
    expect(custom.definitions).toHaveLength(1);
    expect(custom.definitions[0].source).toBe("user");
    expect(custom.usage).toBeNull();
    expect(custom.origin).toBe("custom");

    // used-without-a-definition: builtin agentType, no registry entry.
    const explore = agents.find((a) => a.name === "Explore")!;
    expect(explore.definitions).toEqual([]);
    expect(explore.usage).toMatchObject({ runs: 3, sessions: 1, costUSD: 0.5, lastUsed: "2026-07-10T10:00:00Z" });
    expect(explore.origin).toBe("builtin");

    // usage with no registry match and not in the built-in list → unknown.
    const unknown = agents.find((a) => a.name === "totally-unused-agent-type")!;
    expect(unknown.origin).toBe("unknown");
    expect(unknown.usage).toMatchObject({ runs: 1, costUSD: 0.1 });
  });

  it("returns an empty agents array when the index is empty and no registry exists", async () => {
    fs.rmSync(path.join(ROOT, "agents"), { recursive: true, force: true });
    state.index = [];
    const r = await fetch(`${base}/api/agents`);
    expect(r.status).toBe(200);
    expect((await r.json()).agents).toEqual([]);
  });
});
