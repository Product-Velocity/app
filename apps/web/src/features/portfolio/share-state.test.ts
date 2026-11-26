import { describe, expect, it } from "vitest";
import { confluenceStatus, shareLine, trackerLastSync, whenLabel, type TrackerShare } from "./share-state";

const when = (iso: string) => `@${iso.slice(0, 16)}`;
const jira = (over: Partial<TrackerShare> = {}): TrackerShare => ({ tracker: "Jira", linked: true, writes: true, sentAt: "2026-11-26T14:05:00Z", ...over });

describe("what the chip says about the tracker issue", () => {
  it("not shared: only in Product Velocity", () => {
    expect(shareLine(jira(), { shared: false, kind: "document" }, when)).toMatchObject({ chip: "Not in the Jira issue", on: false, tone: "off" });
  });
  it("a read-only project never says it was shared, whatever the switch says", () => {
    const l = shareLine(jira({ writes: false, sentAt: null }), { shared: true, kind: "document" }, when);
    expect(l).toMatchObject({ chip: "Not sent: read-only", tone: "blocked" });
    expect(l.detail).toContain("nothing is written");
  });
  it("shared but never sent: it goes in at the next send, or with the issue when there is none yet", () => {
    expect(shareLine(jira({ sentAt: null }), { shared: true, kind: "file" }, when)).toMatchObject({ chip: "Goes in at next send", tone: "waiting" });
    expect(shareLine(jira({ linked: false, sentAt: null }), { shared: true, kind: "file" }, when)).toMatchObject({ chip: "Goes in with the issue", tone: "waiting" });
  });
  it("sent after it was added: in the description, with the time of the send", () => {
    expect(shareLine(jira(), { shared: true, kind: "document", changedAt: "2026-11-26T09:00:00Z" }, when)).toEqual({ chip: "In the Jira description", detail: "Sent @2026-11-26T14:05.", on: true, tone: "done" });
  });
  it("added or changed after the last send: it waits for the next one and says both times", () => {
    const l = shareLine(jira(), { shared: true, kind: "document", changedAt: "2026-11-26T16:00:00Z" }, when);
    expect(l).toMatchObject({ chip: "Goes in at next send", tone: "waiting" });
    expect(l.detail).toContain("@2026-11-26T16:00");
    expect(l.detail).toContain("@2026-11-26T14:05");
  });
  it("a link has no time of its own: it says the last send instead of claiming it is in", () => {
    expect(shareLine(jira(), { shared: true, kind: "link" }, when)).toEqual({ chip: "Goes in the Jira description", detail: "Last send to Jira: @2026-11-26T14:05.", on: true, tone: "done" });
  });
  it("names the tracker it is about (GitHub too)", () => {
    expect(shareLine({ tracker: "GitHub", linked: true, writes: true, sentAt: "2026-11-26T14:05:00Z" }, { shared: true, kind: "document", changedAt: null }, when).chip).toBe("In the GitHub description");
  });
  it("formats a time with date, time and no seconds", () => {
    expect(whenLabel("2026-11-26T14:05:00")).toMatch(/^26 Nov 2026, \d{2}:\d{2}$/);
    expect(whenLabel("not a date")).toBe("not a date");
  });
});

import { trackerShareOf } from "./share-state";
import type { Lookups } from "./types";

describe("the tracker side of the chips, from the loaded lookups", () => {
  const lookups = {
    trackers: { jira: true, projectTracker: {}, jiraReadOnly: ["p-ro"] },
    jira: { links: { i1: { mode: "push", issueKey: "PTS-1", url: null, status: null, category: null, lastSynced: null, sentAt: "2026-11-26T14:05:00Z" }, i2: { mode: "follow", issueKey: "PTS-2", url: null, status: null, category: null, lastSynced: null } } },
    github: { connected: true, links: { g1: { mode: "push", number: 7, url: null, state: "synced", error: null, ghState: "open", lastActivity: null, lastPushedAt: "2026-11-25T08:00:00Z" } } },
  } as unknown as Lookups;
  it("Jira: a writable link, its send time; a followed issue and a read-only project do not write", () => {
    expect(trackerShareOf(lookups, "i1", "p1", "Jira")).toEqual({ tracker: "Jira", linked: true, writes: true, sentAt: "2026-11-26T14:05:00Z" });
    expect(trackerShareOf(lookups, "i2", "p1", "Jira").writes).toBe(false);
    expect(trackerShareOf(lookups, "i1", "p-ro", "Jira").writes).toBe(false);
    expect(trackerShareOf(lookups, "none", "p1", "Jira")).toEqual({ tracker: "Jira", linked: false, writes: true, sentAt: null });
  });
  it("GitHub: the push time of the link", () => {
    expect(trackerShareOf(lookups, "g1", "p1", "GitHub")).toEqual({ tracker: "GitHub", linked: true, writes: true, sentAt: "2026-11-25T08:00:00Z" });
  });
});

describe("the labelled lines under a document (issue #714)", () => {
  const c = { source: "pv" as const, direction: "both" as const, linked: true, pageTitle: "Go-to-market", spaceKey: "R89", publishedVersion: 7, publishedAt: "2026-11-26T14:05:00Z", outOfDate: false };
  it("Confluence: a short status and the time, not a sentence", () => {
    expect(confluenceStatus(c, when)).toEqual({ chip: "Two-way", lastLabel: "Last sync", last: "@2026-11-26T14:05" });
    expect(confluenceStatus({ ...c, outOfDate: true }, when).chip).toBe("Two-way: changes waiting");
    expect(confluenceStatus({ ...c, direction: "to_confluence" }, when).chip).toBe("Written to the page");
    expect(confluenceStatus({ ...c, direction: "from_confluence" }, when).chip).toBe("Read from the page");
    expect(confluenceStatus({ ...c, linked: false }, when)).toMatchObject({ chip: "Published once", lastLabel: "Written" });
    expect(confluenceStatus({ ...c, publishedAt: null }, when).last).toBe("not recorded");
  });
  it("the tracker: the time of the last send, or why there is none, also for a read-only project", () => {
    expect(trackerLastSync(jira(), when)).toBe("@2026-11-26T14:05");
    expect(trackerLastSync(jira({ sentAt: null }), when)).toBe("never sent");
    expect(trackerLastSync(jira({ linked: false, sentAt: null }), when)).toBe("no issue yet");
  });
});
