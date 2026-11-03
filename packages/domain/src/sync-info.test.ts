import { describe, expect, it } from "vitest";
import { lastSyncedAt, syncedWith, trackerOwnership, type SyncLink } from "./sync-info";

const link = (over: Partial<SyncLink> = {}): SyncLink => ({ mode: "push", repo: "Acme/App", issueNumber: 38, syncState: "synced", lastPushedAt: null, ghSyncedAt: null, hasBoardItem: false, ...over });

describe("lastSyncedAt: the latest time either direction touched the initiative", () => {
  it("takes the latest of the last send, the last check of GitHub and the item's own mark", () => {
    expect(lastSyncedAt(link({ lastPushedAt: "2026-10-27T10:00:00Z", ghSyncedAt: "2026-10-27T12:30:00Z" }), "2026-10-26T09:00:00Z")).toBe("2026-10-27T12:30:00Z");
    expect(lastSyncedAt(link({ lastPushedAt: "2026-10-27T13:00:00Z", ghSyncedAt: "2026-10-27T12:30:00Z" }), null)).toBe("2026-10-27T13:00:00Z");
    expect(lastSyncedAt(link(), "2026-10-26T09:00:00Z")).toBe("2026-10-26T09:00:00Z");
  });
  it("is empty without a link, or when nothing has happened yet", () => {
    expect(lastSyncedAt(undefined, "2026-10-26T09:00:00Z")).toBeNull();
    expect(lastSyncedAt(link(), null)).toBeNull();
  });
  it("ignores values that are not dates", () => {
    expect(lastSyncedAt(link({ lastPushedAt: "soon", ghSyncedAt: "2026-10-27T12:30:00Z" }), "garbage")).toBe("2026-10-27T12:30:00Z");
  });
});

describe("syncedWith: the platform and place, in words", () => {
  it("names the platform and repository, and the board when the initiative is on one", () => {
    expect(syncedWith(link(), null)).toBe("GitHub · Acme/App");
    expect(syncedWith(link({ hasBoardItem: true }), "Product Velocity roadmap")).toBe('GitHub · Acme/App · board "Product Velocity roadmap"');
    expect(syncedWith(link({ hasBoardItem: true }), null)).toBe("GitHub · Acme/App"); // the board is no longer linked
  });
  it("says when it only follows an issue, when the last send failed, and when nothing was sent yet", () => {
    expect(syncedWith(link({ mode: "follow" }), null)).toBe("GitHub · Acme/App · follows #38, read-only");
    expect(syncedWith(link({ syncState: "error" }), null)).toBe("GitHub · Acme/App · last send failed");
    expect(syncedWith(link({ syncState: "pending", issueNumber: null }), null)).toBe("GitHub · Acme/App · not sent yet");
  });
  it("is empty for an initiative that is not on a tracker", () => {
    expect(syncedWith(undefined, null)).toBe("");
  });
});

describe("trackerOwnership: who owns what a linked initiative is", () => {
  it("is blank for an initiative that is not linked to an issue", () => {
    expect(trackerOwnership(undefined)).toBe("");
  });
  it("Product Velocity when it sends the name, summary, description and hypothesis", () => {
    expect(trackerOwnership(link({ mode: "push" }))).toBe("Product Velocity");
  });
  it("Tracker (read only) when it only follows the issue", () => {
    expect(trackerOwnership(link({ mode: "follow" }))).toBe("Tracker (read only)");
  });
  it("the words are exactly the allowed values of the dictionary field", async () => {
    const { FIELD_BY_KEY } = await import("./registry");
    expect(FIELD_BY_KEY.tracker_ownership!.allowed).toEqual([trackerOwnership(link({ mode: "push" })), trackerOwnership(link({ mode: "follow" }))]);
  });
});

describe("a Jira link", () => {
  const jira = (mode: "push" | "follow", issueKey: string | null) => ({ tracker: "jira" as const, issueKey, mode, repo: "", issueNumber: null, syncState: "synced" as const, lastPushedAt: "2026-11-03T08:00:00Z", ghSyncedAt: null, hasBoardItem: false });
  it("names the Jira issue and who owns the initiative", () => {
    expect(syncedWith(jira("push", "PLAT-3"), null)).toBe("Jira · PLAT-3");
    expect(syncedWith(jira("follow", "PLAT-3"), null)).toBe("Jira · PLAT-3 · follows it, read-only");
    expect(syncedWith(jira("follow", null), null)).toBe("Jira · an issue · follows it, read-only");
    expect(trackerOwnership(jira("follow", "PLAT-3"))).toBe("Tracker (read only)");
    expect(trackerOwnership(jira("push", "PLAT-3"))).toBe("Product Velocity");
  });
  it("Last Synced is the later of the last sync and the item's own mark", () => {
    expect(lastSyncedAt(jira("push", "PLAT-3"), "2026-11-03T09:30:00Z")).toBe("2026-11-03T09:30:00Z");
    expect(lastSyncedAt(jira("push", "PLAT-3"), null)).toBe("2026-11-03T08:00:00Z");
  });
});
