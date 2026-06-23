import type { Facets, SessionMeta } from "../src/types.ts";

function tally(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

const sortDesc = (m: Map<string, number>) =>
  [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

/** Aggregate the session index into facet counts (projects, tickets, skills, …). */
export function computeFacets(index: SessionMeta[]): Facets {
  const projects = new Map<string, { label: string; count: number }>();
  const tickets: string[] = [];
  const skills: string[] = [];
  const branches: string[] = [];
  const models: string[] = [];
  const mcpTools: string[] = [];

  for (const s of index) {
    const p = projects.get(s.projectId) || { label: s.projectLabel, count: 0 };
    p.count++;
    projects.set(s.projectId, p);
    if (s.ticket) tickets.push(s.ticket);
    skills.push(...s.skills);
    branches.push(...s.branches);
    models.push(...s.models);
    mcpTools.push(...s.mcpTools);
  }

  return {
    projects: [...projects.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => b.count - a.count),
    tickets: sortDesc(tally(tickets)),
    skills: sortDesc(tally(skills)),
    branches: sortDesc(tally(branches)),
    models: sortDesc(tally(models)),
    mcpTools: sortDesc(tally(mcpTools)),
  };
}
