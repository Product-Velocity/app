// Which of a Jira project's own issue types are the PV Initiative, Epic and Task (docs/16 mapping table, issue #70).
// Issue types differ per project (team-managed projects have their own; spike J4's project had no "Story"), so the proposal
// is made from that project's types and the admin confirms it. Pure functions: tested without a network.

export type ProjectIssueType = { id: string; name: string; hierarchyLevel: number; subtask: boolean };

export type TypeMapping = { initiative: string | null; epic: string | null; task: string | null; source: "standard" | "above-epic" };

const byName = (types: ProjectIssueType[], ...names: string[]) => types.find((t) => names.includes(t.name.toLowerCase())) ?? null;

export function proposeTypeMapping(types: ProjectIssueType[]): TypeMapping {
  const epics = types.filter((t) => t.hierarchyLevel === 1 && !t.subtask);
  const above = types.filter((t) => t.hierarchyLevel >= 2).sort((a, b) => a.hierarchyLevel - b.hierarchyLevel);
  const base = types.filter((t) => t.hierarchyLevel === 0 && !t.subtask);
  const subs = types.filter((t) => t.subtask || t.hierarchyLevel < 0);
  const epic = byName(epics, "epic") ?? epics[0] ?? null;
  const story = byName(base, "story") ?? base[0] ?? null;
  const sub = byName(subs, "sub-task", "subtask") ?? subs[0] ?? null;
  // a level above Epic: it is the initiative, Epic is the PV epic and the base level the PV task
  if (above[0]) return { source: "above-epic", initiative: above[0].id, epic: epic?.id ?? null, task: story?.id ?? null };
  return { source: "standard", initiative: epic?.id ?? null, epic: story?.id ?? null, task: sub?.id ?? null };
}

/** Where an issue type sits in Jira's hierarchy, in words: sites can have two types with the same name at different levels (an "Initiative" at level 2 and another at level 0). */
export function levelLabel(level: number, subtask = false): string {
  if (subtask || level < 0) return "sub-task";
  if (level >= 2) return `level ${level}, above Epic`;
  return `level ${level}`;
}

/** The label of one issue type in the mapping selects: its name and its level, so equal names can be told apart. */
export const typeOptionLabel = (t: { name: string; hierarchyLevel: number; subtask?: boolean }): string => `${t.name} · ${levelLabel(t.hierarchyLevel, t.subtask)}`;

/** The types in the order an admin looks for them: highest level first (above Epic, Epic, story, sub-task), then by name. */
export function sortTypesByLevel<T extends { name: string; hierarchyLevel: number }>(types: T[]): T[] {
  return [...types].sort((a, b) => b.hierarchyLevel - a.hierarchyLevel || a.name.localeCompare(b.name));
}

/**
 * What the chosen initiative type means, for the line under the selects: above Epic, the initiatives are Jira Initiatives and their epics can come
 * from other Jira projects; at Epic level, epics are the initiatives. Null when nothing is chosen.
 */
export function initiativeLevelHint(types: ProjectIssueType[], initiativeId: string | null): string | null {
  const t = types.find((x) => x.id === initiativeId);
  if (!t) return null;
  if (t.hierarchyLevel >= 2) return `${t.name} is above Epic: each issue of this type is an initiative, its epics (from this or any other Jira project) and their work are read as its tree, and the build comes from the epics.`;
  if (t.hierarchyLevel === 1) return `${t.name} is at Epic level: each issue of this type is an initiative and its stories and tasks are read as its tree.`;
  return `${t.name} is below Epic level: it can be an initiative, but its tree is only its sub-tasks. An initiative is usually an Epic or a level above Epic.`;
}

/** The admin's choice must be types of this project, an initiative is required, and one type cannot play two roles. */
export function validateTypeMapping(types: ProjectIssueType[], chosen: { initiative: string; epic: string | null; task: string | null }): string | null {
  const ids = new Set(types.map((t) => t.id));
  if (!chosen.initiative) return "Choose the Jira issue type that is an initiative.";
  for (const id of [chosen.initiative, chosen.epic, chosen.task]) if (id && !ids.has(id)) return "That issue type does not belong to the Jira project.";
  const picked = [chosen.initiative, chosen.epic, chosen.task].filter((x): x is string => Boolean(x));
  if (new Set(picked).size !== picked.length) return "Initiative, epic and task need three different Jira issue types.";
  return null;
}
