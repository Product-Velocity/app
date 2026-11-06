import { describe, expect, it } from "vitest";
import { notificationTarget, notificationText, sortNotifications, unreadCount, type AppNotification } from "./notifications";

const n = (o: Partial<AppNotification> & { payload?: AppNotification["payload"] }): AppNotification => ({ id: "n", kind: "gate_requested", item_id: "i", review_id: "r", created_at: "2026-11-05T10:00:00Z", read_at: null, payload: { gate: "B", item_code: "R-12", item_name: "New checkout" }, ...o });

describe("what a notification says", () => {
  it("a request names the initiative and the gate, in words", () => {
    expect(notificationText(n({}))).toBe("R-12 New checkout asks for a decision on gate B (Define to Build).");
  });
  it("a decision says the outcome and a fast lane", () => {
    expect(notificationText(n({ kind: "gate_decided", payload: { gate: "A", item_code: "R-3", outcome: "go_with_conditions" } }))).toBe("R-3: gate A (Discover to Define) was decided: Go with conditions.");
    expect(notificationText(n({ kind: "gate_decided", payload: { gate: "B", item_code: "R-3", outcome: "go", fast_lane: true } }))).toContain("Go (fast lane).");
    expect(notificationText(n({ kind: "gate_decided", payload: { gate: "C", item_code: "R-3", outcome: "stop" } }))).toContain("Stop.");
  });
  it("a withdrawal says why", () => {
    expect(notificationText(n({ kind: "gate_withdrawn" }))).toMatch(/was withdrawn because the initiative moved/);
  });
  it("copes with a payload that lost its details", () => {
    expect(notificationText(n({ payload: {} }))).toBe("An initiative asks for a decision on a gate.");
  });
});

describe("where a notification leads", () => {
  it("a request to Decisions, a decision or withdrawal to the initiative", () => {
    expect(notificationTarget(n({}))).toEqual({ kind: "decisions" });
    expect(notificationTarget(n({ kind: "gate_decided", payload: { item_code: "R-12" } }))).toEqual({ kind: "item", code: "R-12" });
    expect(notificationTarget(n({ kind: "gate_decided", payload: {} }))).toBeNull();
  });
});

describe("the list", () => {
  it("counts unread and sorts newest first", () => {
    const a = n({ id: "a", created_at: "2026-11-05T09:00:00Z", read_at: "2026-11-05T09:30:00Z" });
    const b = n({ id: "b", created_at: "2026-11-05T11:00:00Z" });
    expect(unreadCount([a, b])).toBe(1);
    expect(sortNotifications([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});
