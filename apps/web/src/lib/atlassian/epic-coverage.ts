// Epics coverage (issue #464, #431): for each open epic read from the ticked Jira projects, is it linked to a Product Velocity initiative? Pure, so the
// rules are tested without a database. Reading and writing happen elsewhere; nothing here talks to Jira.

export type SeenEpic = { key: string; project: string; title: string; status: string | null; category: "new" | "indeterminate" | "done" | null; parentKey: string | null; url: string | null; updatedAt: string | null };
export type InitiativeRef = { id: string; code: string; name: string };
export type EpicState =
  | "linked" // the epic is the Jira issue of an initiative (an initiative linked straight to the epic)
  | "under" // the epic sits under the Jira issue of an initiative (a Jira Initiative), or is in its tree
  | "requested" // the epic is listed on an initiative and waits for the next Sync with Jira
  | "initiative_not_in_pv" // the epic has a Jira Initiative as parent, and no initiative of ours is linked to it
  | "not_linked";

export type EpicCoverageRow = SeenEpic & { state: EpicState; initiative: InitiativeRef | null; /** The Jira parent when it is not in Product Velocity, or the failure of a request. */ note: string | null };

export type CoverageInput = {
  epics: SeenEpic[];
  items: InitiativeRef[];
  /** item id -> the Jira issue key it is linked to */
  links: { itemId: string; issueKey: string }[];
  /** the epics (first level) already read under a linked issue */
  tree: { itemId: string; issueKey: string }[];
  requests: { itemId: string; epicKey: string; state: "pending" | "linked" | "failed"; error: string | null }[];
};

const STATE_ORDER: Record<EpicState, number> = { not_linked: 0, initiative_not_in_pv: 1, requested: 2, under: 3, linked: 4 };

export function classifyEpics(input: CoverageInput): EpicCoverageRow[] {
  const item = new Map(input.items.map((i) => [i.id, i]));
  const byLink = new Map(input.links.map((l) => [l.issueKey, l.itemId]));
  const byTree = new Map(input.tree.map((t) => [t.issueKey, t.itemId]));
  const byRequest = new Map(input.requests.filter((r) => r.state !== "failed").map((r) => [r.epicKey, r.itemId]));
  const failed = new Map(input.requests.filter((r) => r.state === "failed").map((r) => [r.epicKey, r.error]));
  const out = input.epics.map((e): EpicCoverageRow => {
    const make = (state: EpicState, itemId: string | undefined, note: string | null = null): EpicCoverageRow => ({ ...e, state, initiative: (itemId && item.get(itemId)) || null, note });
    const direct = byLink.get(e.key);
    if (direct) return make("linked", direct);
    const inTree = byTree.get(e.key);
    if (inTree) return make("under", inTree);
    const viaParent = e.parentKey ? byLink.get(e.parentKey) : undefined;
    if (viaParent) return make("under", viaParent);
    const wanted = byRequest.get(e.key);
    if (wanted) return make("requested", wanted);
    if (e.parentKey) return make("initiative_not_in_pv", undefined, e.parentKey);
    return make("not_linked", undefined, failed.has(e.key) ? `A request to link it failed: ${failed.get(e.key) ?? "Jira refused it."}` : null);
  });
  return out.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.project.localeCompare(b.project) || a.key.localeCompare(b.key, "en", { numeric: true }));
}

export const STATE_LABEL: Record<EpicState, string> = {
  not_linked: "Not linked",
  initiative_not_in_pv: "Under a Jira Initiative not in Product Velocity",
  requested: "Waiting for Sync",
  under: "Linked (under its Jira Initiative)",
  linked: "Linked (is the initiative's issue)",
};

/** The GitHub twin (issue #465): an epic is an open parent issue, its key is "owner/repo#12" and its "Initiative" is the parent issue of an initiative. */
export const STATE_LABEL_GITHUB: Record<EpicState, string> = {
  not_linked: "Not linked",
  initiative_not_in_pv: "Under a parent issue not in Product Velocity",
  requested: "Waiting for Sync",
  under: "Linked (under its parent issue)",
  linked: "Linked (is the initiative's issue)",
};

export type EpicTracker = "jira" | "github";

/** Wording and states of the Epics list per tracker, so the one view serves both (tracker parity). Waiting for Sync needs the request flow, which GitHub does not have yet (#458). */
export const EPIC_COPY: Record<EpicTracker, { name: string; labels: Record<EpicState, string>; states: EpicState[]; canList: boolean; settings: string; settingsName: string; what: string; where: string }> = {
  jira: { name: "Jira", labels: STATE_LABEL, states: ["not_linked", "initiative_not_in_pv", "requested", "under", "linked"], canList: true, settings: "/settings/integrations/jira", settingsName: "Projects to check for epics", what: "Jira projects", where: "Sync with Jira" },
  github: { name: "GitHub", labels: STATE_LABEL_GITHUB, states: ["not_linked", "initiative_not_in_pv", "under", "linked"], canList: false, settings: "/settings/integrations/github", settingsName: "Repositories to check for epics", what: "repositories", where: "Sync with GitHub" },
};

/** The key of an issue on GitHub, as the Epics list and the links use it. Repository names are not case sensitive, so matching lower-cases it. */
export const githubIssueKey = (repo: string, number: number) => `${repo}#${number}`;

/** How many epics need a decision: the ones with no initiative of ours, whether or not a Jira Initiative holds them. */
export const needsDecision = (rows: readonly EpicCoverageRow[]) => rows.filter((r) => r.state === "not_linked" || r.state === "initiative_not_in_pv").length;

/** The JQL for the open epics of one project: the type ids are the site's issue types at hierarchy level 1 (an epic is level 1 whatever it is called). */
export function openEpicsJql(projectKey: string, typeIds: string[]): string {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) throw new Error("Not a Jira project key");
  if (typeIds.length === 0 || !typeIds.every((t) => /^[0-9]{1,20}$/.test(t))) throw new Error("No epic issue type");
  return `project = "${projectKey}" AND issuetype in (${typeIds.join(", ")}) AND statusCategory != Done ORDER BY updated DESC`;
}
