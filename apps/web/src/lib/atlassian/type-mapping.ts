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

/** The admin's choice must be types of this project, an initiative is required, and one type cannot play two roles. */
export function validateTypeMapping(types: ProjectIssueType[], chosen: { initiative: string; epic: string | null; task: string | null }): string | null {
  const ids = new Set(types.map((t) => t.id));
  if (!chosen.initiative) return "Choose the Jira issue type that is an initiative.";
  for (const id of [chosen.initiative, chosen.epic, chosen.task]) if (id && !ids.has(id)) return "That issue type does not belong to the Jira project.";
  const picked = [chosen.initiative, chosen.epic, chosen.task].filter((x): x is string => Boolean(x));
  if (new Set(picked).size !== picked.length) return "Initiative, epic and task need three different Jira issue types.";
  return null;
}
