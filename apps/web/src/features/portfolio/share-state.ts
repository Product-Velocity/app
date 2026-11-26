// What the chip on a document, file or link says about the tracker issue (issue #714). It used to show the setting only ("Shared with Jira"), which read like
// "it is in Jira" even when nothing had ever been sent (a read-only project, or no send yet). Now the chip says what WILL happen or what DID, and a second line
// gives the time, so nobody has to guess. Pure, so the rules are tested without a screen.

export type TrackerShare = {
  tracker: string;
  /** The initiative has an issue in the tracker. */
  linked: boolean;
  /** Product Velocity may write to the issue: false for a read-only Jira project and for an issue that is only followed. */
  writes: boolean;
  /** When something was last written to the issue (ISO), or null. */
  sentAt: string | null;
};
export type ShareEntry = {
  shared: boolean;
  kind: "document" | "file" | "link";
  /** When the entry was added or last changed (ISO). Links have no time of their own. */
  changedAt?: string | null;
};
export type ShareLine = { chip: string; detail: string; on: boolean; tone: "done" | "waiting" | "off" | "blocked" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "26 Nov 2026, 14:05" in the viewer's time zone. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function shareLine(t: TrackerShare, e: ShareEntry, when: (iso: string) => string = whenLabel): ShareLine {
  const T = t.tracker;
  if (!e.shared) return { chip: `Not in the ${T} issue`, detail: "Only in Product Velocity.", on: false, tone: "off" };
  if (!t.writes) return { chip: "Not sent: read-only", detail: `${T} is read-only for this initiative, so nothing is written to the issue. It goes in only if writing is switched on.`, on: true, tone: "blocked" };
  if (!t.linked) return { chip: "Goes in with the issue", detail: `Not sent yet. It goes in the ${T} description when the issue is created at the next send.`, on: true, tone: "waiting" };
  if (!t.sentAt) return { chip: "Goes in at next send", detail: `Not sent yet. It goes in the ${T} description at the next send.`, on: true, tone: "waiting" };
  if (e.kind === "link" || (e.kind === "file" && !e.changedAt)) return { chip: `Goes in the ${T} description`, detail: `Last send to ${T}: ${when(t.sentAt)}.`, on: true, tone: "done" };
  if (e.changedAt && Date.parse(e.changedAt) > Date.parse(t.sentAt)) {
    return { chip: "Goes in at next send", detail: `Added or changed ${when(e.changedAt)}, after the last send to ${T} (${when(t.sentAt)}). It goes in at the next send.`, on: true, tone: "waiting" };
  }
  return { chip: `In the ${T} description`, detail: `Sent ${when(t.sentAt)}.`, on: true, tone: "done" };
}

import type { Lookups } from "./types";

/** The tracker side of the chips for one initiative, from what the grid already loaded: is there an issue, may we write to it, and when did we last write. */
export function trackerShareOf(lookups: Lookups, itemId: string, projectId: string | undefined, tracker: "GitHub" | "Jira"): TrackerShare {
  if (tracker === "Jira") {
    const l = lookups.jira?.links[itemId];
    const readOnlyProject = projectId !== undefined && lookups.trackers?.jiraReadOnly?.includes(projectId) === true;
    return { tracker, linked: Boolean(l), writes: !readOnlyProject && l?.mode !== "follow", sentAt: l?.sentAt ?? null };
  }
  const l = lookups.github?.links[itemId];
  return { tracker, linked: Boolean(l && l.number != null), writes: l?.mode !== "follow", sentAt: l?.lastPushedAt ?? null };
}
