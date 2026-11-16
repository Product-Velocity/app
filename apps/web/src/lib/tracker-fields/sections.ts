// The sections of a delivery tracker's settings (decision 2026-11-16-tracker-settings-sections): the same five, in setup order, on GitHub and Jira.
// Pure: the pages supply what is connected and linked; this decides the tab list, the addresses and the next step.

export type TrackerSection = "connection" | "projects" | "mapping" | "inbox" | "logs";

export const TRACKER_SECTIONS: readonly { id: TrackerSection; label: string; suffix: string; /** needs a working connection first */ needsConnection: boolean }[] = [
  { id: "connection", label: "Connection", suffix: "", needsConnection: false },
  { id: "projects", label: "Projects", suffix: "/projects", needsConnection: true },
  { id: "mapping", label: "Field mapping", suffix: "/mapping", needsConnection: true },
  { id: "inbox", label: "Inbox", suffix: "/inbox", needsConnection: true },
  { id: "logs", label: "Sync & logs", suffix: "/logs", needsConnection: true },
];

export const sectionPath = (base: string, id: TrackerSection): string => `${base}${TRACKER_SECTIONS.find((s) => s.id === id)!.suffix}`;

export type SetupStep = { id: "connect" | "link" | "mapping"; label: string; done: boolean; /** the mapping step is never required: the defaults work */ optional: boolean; section: TrackerSection };

/** The three steps of a first set-up and which are done. `customised` = at least one project has its own field settings. */
export function setupSteps(i: { tracker: string; connected: boolean; linkedProjects: number; customised: boolean }): SetupStep[] {
  return [
    { id: "connect", label: `Connect ${i.tracker}`, done: i.connected, optional: false, section: "connection" },
    { id: "link", label: `Choose which projects use ${i.tracker}`, done: i.connected && i.linkedProjects > 0, optional: false, section: "projects" },
    { id: "mapping", label: "Check the field mapping (the defaults work)", done: i.connected && i.linkedProjects > 0 && i.customised, optional: true, section: "mapping" },
  ];
}

/** The first required step that is not done, or null when set-up is complete. */
export function nextStep(steps: readonly SetupStep[]): SetupStep | null {
  return steps.find((s) => !s.done && !s.optional) ?? null;
}

export const setupComplete = (steps: readonly SetupStep[]): boolean => nextStep(steps) === null;
