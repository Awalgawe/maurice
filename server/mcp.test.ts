import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.ts";

// Wire a client to a fresh Maurice MCP server over an in-memory transport pair.
// Listing tools exercises the registration/schema wiring without touching CLAUDE_DIR.
async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("createMcpServer", () => {
  it("registers the expected read-only tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "agents",
      "cost_summary",
      "filters",
      "get_session",
      "list_bilans",
      "list_memories",
      "list_sessions",
      "read_bilan",
      "recent_errors",
      "search_sessions",
    ]);
    await client.close();
  });

  it("exposes input schemas and marks tools read-only", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const search = tools.find((t) => t.name === "search_sessions")!;
    expect(search.inputSchema.type).toBe("object");
    expect(Object.keys(search.inputSchema.properties ?? {})).toContain("q");
    expect(search.inputSchema.required).toContain("q");
    expect(search.annotations?.readOnlyHint).toBe(true);

    const getSession = tools.find((t) => t.name === "get_session")!;
    expect(getSession.inputSchema.required).toContain("id");

    await client.close();
  });
});
