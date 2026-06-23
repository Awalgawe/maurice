import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { api } from "./routes/api.ts";
import { mcp } from "./routes/mcp.ts";
import { getIndex } from "./cache.ts";
import { hostGuard } from "./hostGuard.ts";
import { CLAUDE_DIR } from "./claudeDir.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const isProd = process.env.NODE_ENV === "production";

const app = express();

// Per-request timing (opt-in via PERF=1) to surface slow endpoints.
if (process.env.PERF) {
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on("finish", () => {
      console.log(`[perf] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - t0}ms)`);
    });
    next();
  });
}

app.use(hostGuard(PORT));

app.use("/api", api);
// Unknown /api routes must 404 as JSON, never fall through to the SPA fallback.
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// MCP endpoint: exposes Maurice's read-only data as MCP tools. Mounted before
// the SPA fallback so /mcp is never swallowed by index.html.
app.use("/mcp", mcp);

if (isProd) {
  const dist = path.join(__dirname, "..", "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    // SPA fallback for client-side routes (never /api/*, handled above).
    // Regex catch-all: Express 5 / path-to-regexp v8 rejects a bare "*" string.
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    console.warn("dist/ not found — run `npm run build` first.");
  }
}

// Bind to loopback only: this serves the private contents of ~/.claude and must
// not be reachable from the LAN.
app.listen(PORT, "127.0.0.1", async () => {
  console.log(`claude-sessions API on http://localhost:${PORT}`);
  console.log(`Reading (read-only) from: ${CLAUDE_DIR}`);
  // Warm the index so the first request is fast.
  console.log("Building session index…");
  const t0 = Date.now();
  const idx = await getIndex();
  console.log(`Index ready: ${idx.length} sessions in ${Date.now() - t0}ms`);
});
