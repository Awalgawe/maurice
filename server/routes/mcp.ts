import { Router } from "express";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../mcp.ts";

const PORT = Number(process.env.PORT || 5174);

// Hosts the transport accepts in the Host header. Like the rest of Maurice, the
// MCP endpoint is loopback-only; DNS-rebinding protection rejects any other Host
// so a visited web page can't drive the local server through the browser.
const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
];

export const mcp = Router();

// JSON-RPC request bodies; the transport reads the pre-parsed body.
mcp.use(express.json());

// Stateless transport: a fresh server + transport per request (no session state
// to retain — every tool reads the index/parsers on demand). This is the simplest
// correct mode and avoids leaking per-connection state across MCP clients.
async function handle(req: express.Request, res: express.Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: ALLOWED_HOSTS,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: err instanceof Error ? err.message : "internal error" },
        id: null,
      });
    }
  }
}

mcp.post("/", handle);

// In stateless mode there is no server-initiated SSE stream and no session to
// terminate, so GET/DELETE have nothing to serve.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
mcp.get("/", methodNotAllowed);
mcp.delete("/", methodNotAllowed);
