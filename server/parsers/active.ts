import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { PROJECTS_DIR } from "../claudeDir.ts";
import { tokensFromUsage } from "./jsonl.ts";
import { estimateCost } from "../pricing.ts";
import type { ActiveSession, TokenTotals } from "../../src/types.ts";

const ACTIVE_THRESHOLD_MS = 60_000;

interface ActiveFile {
  filePath: string;
  projectId: string;
  stat: fs.Stats;
}

// Cache keyed by a fingerprint of all active files (paths + mtimes + sizes).
let cache: { key: string; result: ActiveSession | { active: false } } | null = null;

function findActiveFiles(): ActiveFile[] {
  const now = Date.now();
  const found: ActiveFile[] = [];
  let projectDirs: string[];
  try { projectDirs = fs.readdirSync(PROJECTS_DIR); } catch { return found; }
  for (const projectId of projectDirs) {
    const projectDir = path.join(PROJECTS_DIR, projectId);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(projectDir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projectDir, e.name);
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (now - stat.mtimeMs > ACTIVE_THRESHOLD_MS) continue;
      found.push({ filePath, projectId, stat });
    }
  }
  return found;
}

function fingerprint(files: ActiveFile[]): string {
  return files.map((f) => `${f.filePath}:${f.stat.mtimeMs}:${f.stat.size}`).sort().join("|");
}

async function parseFile(f: ActiveFile): Promise<{ tokens: TokenTotals; estCostUSD: number; messageCount: number; startedAt: string; lastModel: string | null } | null> {
  const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let estCostUSD = 0;
  let startedAt = "";
  let messageCount = 0;
  let lastModel: string | null = null;
  const seenUsage = new Set<string>();
  try {
    const stream = fs.createReadStream(f.filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        if (!startedAt && obj.timestamp) startedAt = obj.timestamp;
        if (obj.type !== "assistant") continue;
        const msg = obj.message ?? obj;
        const model = msg.model ?? obj.model;
        if (model) lastModel = model;
        if (!msg?.usage) continue;
        const key = obj.requestId || msg.id || obj.uuid;
        if (key && seenUsage.has(key)) continue;
        if (key) seenUsage.add(key);
        const t = tokensFromUsage(msg.usage);
        tokens.input += t.input;
        tokens.output += t.output;
        tokens.cacheRead += t.cacheRead;
        tokens.cacheCreate += t.cacheCreate;
        estCostUSD += estimateCost(model, t);
        messageCount++;
      }
    } finally {
      rl.close();
      stream.close();
    }
  } catch {
    return null;
  }
  return { tokens, estCostUSD, messageCount, startedAt, lastModel };
}

export async function getActiveSession(): Promise<ActiveSession | { active: false }> {
  const files = findActiveFiles();
  if (!files.length) { cache = null; return { active: false }; }

  const key = fingerprint(files);
  if (cache?.key === key) return cache.result;

  const parsed = (await Promise.all(files.map(parseFile))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof parseFile>>>[];
  if (!parsed.length) { cache = null; return { active: false }; }

  const agg: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let estCostUSD = 0;
  let messageCount = 0;
  let oldestMs = Date.now();
  let lastModel: string | null = null;

  for (const p of parsed) {
    agg.input += p.tokens.input;
    agg.output += p.tokens.output;
    agg.cacheRead += p.tokens.cacheRead;
    agg.cacheCreate += p.tokens.cacheCreate;
    estCostUSD += p.estCostUSD;
    messageCount += p.messageCount;
    if (p.startedAt) oldestMs = Math.min(oldestMs, new Date(p.startedAt).getTime());
    if (p.lastModel) lastModel = p.lastModel;
  }

  const projectPath = files.length === 1
    ? files[0].projectId.replace(/^-/, "").replace(/-/g, "/")
    : "";

  const result: ActiveSession = {
    active: true,
    sessionCount: files.length,
    projectPath,
    elapsedMs: Date.now() - oldestMs,
    tokens: agg,
    estCostUSD,
    messageCount,
    model: lastModel,
  };
  cache = { key, result };
  return result;
}
