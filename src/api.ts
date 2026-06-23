import type {
  ActiveSession,
  BilanDetail,
  BilanMeta,
  Facets,
  HookEntry,
  McpInfo,
  MemoryEntry,
  PlanEntry,
  SearchHit,
  SessionDetail,
  SessionMeta,
  ThreadMessage,
} from "./types";

async function get<T>(url: string): Promise<T> {
  const t0 = import.meta.env.DEV ? performance.now() : 0;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const data = (await r.json()) as T;
  if (import.meta.env.DEV) console.log(`[perf] GET ${url} (${(performance.now() - t0).toFixed(0)}ms)`);
  return data;
}

export const getSessions = () => get<SessionMeta[]>("/api/sessions");
export const getActive = () => get<ActiveSession | { active: false }>("/api/active");
export const getFilters = () => get<Facets>("/api/filters");
export const getDetail = (id: string, offset = 0, limit = 200) =>
  get<SessionDetail>(`/api/sessions/${id}?offset=${offset}&limit=${limit}`);
export const getSubagent = (id: string, ref: string) =>
  get<{ messages: ThreadMessage[] }>(`/api/sessions/${id}/subagents/${ref}`);
export const search = (q: string) =>
  get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`);
export const getMemories = () => get<MemoryEntry[]>("/api/memories");
export const getSessionMemories = (sessionId: string) =>
  get<MemoryEntry[]>(`/api/memories?sessionId=${encodeURIComponent(sessionId)}`);

export const getBilans = () => get<BilanMeta[]>("/api/bilans");
export const getBilan = (id: string) => get<BilanDetail>(`/api/bilans/${encodeURIComponent(id)}`);

export const deleteMemory = (projectId: string, filename: string): Promise<void> =>
  fetch("/api/memories", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, filename }),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  });

export const getPlans = () => get<PlanEntry[]>("/api/plans");

export const getHooks = () => get<HookEntry[]>("/api/hooks");

export const getMcpTools = () => get<McpInfo>("/api/mcp-tools");

export const deletePlan = (scope: string, projectId: string, filename: string): Promise<void> =>
  fetch("/api/plans", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, projectId, filename }),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  });

export const renamePlan = (scope: string, projectId: string, filename: string, newName: string): Promise<void> =>
  fetch("/api/plans", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, projectId, filename, newName }),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  });
