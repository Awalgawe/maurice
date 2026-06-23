import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR, projectLabel } from "../claudeDir.ts";
import { getIndex } from "../cache.ts";
import type { HookEntry } from "../../src/types.ts";

export const GLOBAL_SETTINGS = path.join(CLAUDE_DIR, "settings.json");
export const GLOBAL_SETTINGS_LOCAL = path.join(CLAUDE_DIR, "settings.local.json");

/** .claude dir holding a project's settings, given its real cwd. */
export function settingsDirForProject(projectPath: string): string {
  return path.join(projectPath, ".claude");
}

/**
 * Flatten the `hooks` block of one settings.json into HookEntry rows. A missing
 * file, unreadable file, malformed JSON, or absent `hooks` key all yield [] —
 * never a throw (settings.local.json often holds only `permissions`).
 */
export function readSettingsHooks(
  filePath: string,
  scope: HookEntry["scope"],
  projectId: string | null,
  label: string | null,
): HookEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
  const hooks = (parsed as { hooks?: unknown })?.hooks;
  if (!hooks || typeof hooks !== "object") return [];
  const out: HookEntry[] = [];
  for (const [event, matchers] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      const matcher = typeof m?.matcher === "string" ? m.matcher : "";
      const list = Array.isArray(m?.hooks) ? m.hooks : [];
      for (const h of list) {
        out.push({
          event,
          matcher,
          type: typeof h?.type === "string" ? h.type : "command",
          command: typeof h?.command === "string" ? h.command : "",
          async: h?.async === true,
          timeout: typeof h?.timeout === "number" ? h.timeout : null,
          scope,
          projectId,
          projectLabel: label,
          sourceFile: filePath,
        });
      }
    }
  }
  return out;
}

const SCOPE_ORDER: Record<HookEntry["scope"], number> = {
  global: 0,
  "global-local": 1,
  project: 2,
  "project-local": 3,
};

/**
 * Aggregate hooks from the global settings (~/.claude) and every known project's
 * <cwd>/.claude settings. Project paths come from the session index's captured
 * cwd, deduped by resolved dir so a session run from $HOME (whose .claude IS the
 * global dir) is not read twice. Sorted by event, then scope.
 */
export async function listHooks(): Promise<HookEntry[]> {
  const out: HookEntry[] = [
    ...readSettingsHooks(GLOBAL_SETTINGS, "global", null, null),
    ...readSettingsHooks(GLOBAL_SETTINGS_LOCAL, "global-local", null, null),
  ];

  const index = await getIndex();
  const seen = new Map<string, string>(); // projectId -> projectPath
  for (const s of index) {
    if (s.projectPath && !seen.has(s.projectId)) seen.set(s.projectId, s.projectPath);
  }
  const seenDirs = new Set<string>([path.resolve(CLAUDE_DIR)]);
  for (const [projectId, projectPath] of seen) {
    const dir = path.resolve(settingsDirForProject(projectPath));
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const label = projectLabel(projectPath);
    out.push(...readSettingsHooks(path.join(dir, "settings.json"), "project", projectId, label));
    out.push(...readSettingsHooks(path.join(dir, "settings.local.json"), "project-local", projectId, label));
  }

  out.sort((a, b) => a.event.localeCompare(b.event) || SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope]);
  return out;
}
