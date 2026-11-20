// Test-only helpers: JSONL transcripts for the fork-dedup tests, parsed through
// the real buildMetaAndDocs so the per-request records under test are the ones
// the parser actually writes.
import fs from "node:fs";
import path from "node:path";
import { buildMetaAndDocs } from "./parsers/sessions.ts";
import type { SessionMeta } from "../src/types.ts";

export interface Req {
  id: string; // requestId (preserved by a fork copy)
  ts: string;
  skill?: string;
  model?: string;
  t: [input: number, output: number, cacheRead: number, cacheCreate: number];
  sidechain?: boolean;
  siblings?: number; // extra lines of the same request (parallel tool calls)
}

/** One user prompt + one assistant line (plus siblings) per request. `tag`
 *  makes uuids file-unique: a copy regenerates them. */
export function transcript(tag: string, reqs: Req[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  reqs.forEach((r, i) => {
    out.push({ uuid: `${tag}-u${i}`, type: "user", timestamp: r.ts, cwd: "/tmp/proj", message: { role: "user", content: `q${i}` } });
    for (let k = 0; k <= (r.siblings ?? 0); k++) {
      out.push({
        uuid: `${tag}-a${i}-${k}`,
        type: "assistant",
        timestamp: r.ts,
        requestId: r.id,
        ...(r.sidechain ? { isSidechain: true } : {}),
        ...(r.skill ? { attributionSkill: r.skill } : {}),
        message: {
          id: `msg-${r.id}`,
          role: "assistant",
          model: r.model ?? "claude-opus-4-1",
          content: [{ type: "text", text: `a${i}` }],
          usage: {
            input_tokens: r.t[0],
            output_tokens: r.t[1],
            cache_read_input_tokens: r.t[2],
            cache_creation_input_tokens: r.t[3],
          },
        },
      });
    }
  });
  return out;
}

export async function parseSession(dir: string, id: string, projectId: string, lines: Record<string, unknown>[]): Promise<SessionMeta> {
  const fp = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const stat = fs.statSync(fp);
  return (await buildMetaAndDocs({ id, projectId, filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs })).meta;
}

/** Deterministic pseudo-random requests with non-round token counts, so the
 *  per-request micro-USD rounding leaves a real residue against the float sum. */
export function randomReqs(prefix: string, n: number, seed: number, days: string[], skills: string[]): Req[] {
  let x = seed;
  const rnd = (m: number) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % m;
  };
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    ts: `${days[i % days.length]}T12:${String(i % 60).padStart(2, "0")}:00Z`,
    skill: skills[rnd(skills.length)],
    model: rnd(2) ? "claude-opus-4-1" : "claude-sonnet-4-6",
    t: [1 + rnd(9973), 1 + rnd(4999), 1 + rnd(199_999), 1 + rnd(49_999)],
  }));
}
