import { describe, expect, it } from "vitest";
import { changeFlags, nextOutcomeStep, outcomeDueOn, resolveFlagAction, notificationText, type OutcomeReview } from "./index";

const TODAY = new Date(Date.UTC(2026, 10, 19)); // 2026-11-19
const todayNum = Math.round(TODAY.getTime() / 86_400_000);
const rev = (days: number, o: Partial<OutcomeReview> = {}): OutcomeReview => ({ item_id: "a", at_days: days, due_on: "2026-01-01", requested_at: null, realised_kr_value: null, adoption_pct: null, notes: null, recorded_at: null, ...o });
const row = (o: Record<string, unknown> = {}) => ({ id: "a", item_code: "R-1", initiative_name: "x", stack_rank: 1, initiative_status: "Active", initiative_phase: "Roll-out", health: "On Track", sponsor: "Dana", kr_metric: "Activation", start_rollout: "2026-10-20", ...o });

describe("outcome review checkpoints (Ashu 2026-11-19)", () => {
  it("each checkpoint is due that many days after Start Roll-Out", () => {
    expect(outcomeDueOn("2026-10-20", 30)).toBe("2026-11-19");
    expect(outcomeDueOn("2026-10-20", 90)).toBe("2027-01-18");
    expect(outcomeDueOn(null, 30)).toBeNull();
  });

  it("asks for the 30 day metrics once it is due (or within a week), and not before", () => {
    expect(nextOutcomeStep(row(), [], todayNum)).toMatchObject({ kind: "request", days: 30, overdueDays: 0 });
    expect(nextOutcomeStep(row({ start_rollout: "2026-10-01" }), [], todayNum)).toMatchObject({ kind: "request", days: 30, overdueDays: 19 });
    expect(nextOutcomeStep(row({ start_rollout: "2026-10-27" }), [], todayNum)).toMatchObject({ kind: "request", days: 30 }); // due in 7 days
    expect(nextOutcomeStep(row({ start_rollout: "2026-11-10" }), [], todayNum)).toBeNull(); // due 10 Dec
  });

  it("moves on to the next checkpoint once one is recorded, and to Record when one is only requested", () => {
    expect(nextOutcomeStep(row({ start_rollout: "2026-08-01" }), [rev(30, { recorded_at: "2026-09-02T00:00:00Z" })], todayNum)).toMatchObject({ kind: "request", days: 60 });
    expect(nextOutcomeStep(row({ start_rollout: "2026-08-01" }), [rev(30, { recorded_at: "x" }), rev(60, { requested_at: "2026-10-01T00:00:00Z" })], todayNum)).toMatchObject({ kind: "record", days: 60 });
    expect(nextOutcomeStep(row({ start_rollout: "2026-01-01" }), [rev(30, { recorded_at: "x" }), rev(60, { recorded_at: "x" }), rev(90, { recorded_at: "x" })], todayNum)).toBeNull();
  });

  it("only for Roll-out or Completed, with a Start Roll-Out, and never for a Cancelled initiative", () => {
    expect(nextOutcomeStep(row({ initiative_phase: "Build" }), [], todayNum)).toBeNull();
    expect(nextOutcomeStep(row({ initiative_phase: "Completed" }), [], todayNum)).toMatchObject({ kind: "request" });
    expect(nextOutcomeStep(row({ start_rollout: null }), [], todayNum)).toBeNull();
    expect(nextOutcomeStep(row({ initiative_status: "Cancelled" }), [], todayNum)).toBeNull();
  });
});

describe("the outcome flags", () => {
  const kinds = (reviews?: OutcomeReview[], o: Record<string, unknown> = {}) => (changeFlags([row(o)], TODAY, reviews ? { outcomeReviews: reviews } : {}).get("a") ?? []).map((f) => f.kind);

  it("Outcome review due carries the Request 30-day metrics action", () => {
    const f = changeFlags([row()], TODAY, { outcomeReviews: [] }).get("a")!.find((x) => x.kind === "outcome-due")!;
    expect(f.label).toBe("Outcome review due");
    expect(f.action).toEqual({ type: "outcome-request", days: 30, label: "Request 30-day metrics" });
    expect(resolveFlagAction(f.action!, "Roll-out")).toMatchObject({ kind: "outcome-request", days: 30 });
  });

  it("after the request the flag asks to record, and once recorded it goes", () => {
    expect(kinds([rev(30, { requested_at: "2026-11-19T00:00:00Z" })])).toContain("outcome-requested");
    expect(kinds([rev(30, { requested_at: "2026-11-19T00:00:00Z" })])).not.toContain("outcome-due");
    expect(kinds([rev(30, { recorded_at: "2026-11-19T00:00:00Z" })])).not.toContain("outcome-due");
    expect(kinds([rev(30, { recorded_at: "2026-11-19T00:00:00Z" })])).not.toContain("outcome-requested");
  });

  it("with no reviews loaded there is no outcome flag at all, rather than a wrong one", () => {
    expect(kinds(undefined)).not.toContain("outcome-due");
  });
});

describe("the notification for a request", () => {
  it("says which initiative and which checkpoint, in words", () => {
    const n = { id: "1", kind: "outcome_requested" as const, item_id: "a", review_id: null, created_at: "2026-11-19T00:00:00Z", read_at: null, payload: { at_days: 30, item_code: "R-1", item_name: "Faster onboarding" } };
    expect(notificationText(n)).toBe("R-1 Faster onboarding: the 30 day outcome metrics were requested. Please record them.");
  });
});

import { FLAG_FIELDS, FIELD_BY_KEY, panelField } from "./index";
describe("the fields a flag is about (item panel, flagged section)", () => {
  it("every field named exists, and the ones shown can be edited in the panel", () => {
    for (const [flag, keys] of Object.entries(FLAG_FIELDS)) for (const k of keys) expect(FIELD_BY_KEY[k], `${flag}: ${k}`).toBeDefined();
    const editable = (k: string) => !["later", "readonly"].includes(panelField(FIELD_BY_KEY[k]!).kind);
    expect(FLAG_FIELDS["no-owner"]!.every(editable)).toBe(true);
    expect(FLAG_FIELDS["no-kr"]!.every(editable)).toBe(true);
    expect(Object.values(FLAG_FIELDS).flat()).not.toContain("initiative_phase"); // the phase moves through the gate buttons (a gate-passing edit is refused), so no flag offers it as a field
  });
  it("a Business Owner is an open list and the KR unit a dropdown, so the panel gives each its own editor", () => {
    expect(panelField(FIELD_BY_KEY.sponsor!).kind).toBe("openlist");
    expect(panelField(FIELD_BY_KEY.kr_unit!).kind).toBe("select");
  });
});
