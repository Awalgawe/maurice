import type { RequestHandler } from "express";

// DNS-rebinding defense: only accept loopback Host headers. Mirrors the MCP
// transport's allowlist (server/routes/mcp.ts) but covers /api and the SPA too.
export function hostGuard(port: number): RequestHandler {
  const allowed = new Set([
    "localhost", "127.0.0.1", `localhost:${port}`, `127.0.0.1:${port}`,
  ]);
  return (req, res, next) => {
    const host = req.headers.host;
    if (!host || !allowed.has(host)) {
      res.status(403).json({ error: "forbidden host" });
      return;
    }
    next();
  };
}
