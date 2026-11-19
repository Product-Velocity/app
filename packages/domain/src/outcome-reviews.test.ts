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

import { outcomeColumns, OUTCOME_COLUMN_KEYS } from "./index";
describe("the Outcome reviews columns", () => {
  const rr = (days: number, o: Partial<OutcomeReview> = {}) => rev(days, { recorded_at: "2026-11-20T00:00:00Z", ...o });
  const base = row({ start_rollout: "2026-08-01", kr_start: 10, kr_target: 110 });

  it("are empty for an initiative that has not reached Roll-out, has no Start Roll-Out, or is Cancelled", () => {
    for (const o of [{ initiative_phase: "Build" }, { start_rollout: null }, { initiative_status: "Cancelled" }]) {
      expect(outcomeColumns(row(o), [])).toEqual({ outcome_status: null, outcome_review_date: null, outcome_reviews_recorded: null, realized_kr_value: null, kr_realized_pct: null, outcome_latest_adoption: null, outcome_kr_progress: null });
    }
  });

  it("with nothing recorded: the first checkpoint is next and 0 of 3 are recorded", () => {
    expect(outcomeColumns(base, [])).toMatchObject({ outcome_review_date: "2026-08-31", outcome_reviews_recorded: "0 of 3", realized_kr_value: null, outcome_kr_progress: null });
  });

  it("the next review is the earliest checkpoint nobody recorded; a requested one is still next", () => {
    expect(outcomeColumns(base, [rr(30), rev(60, { requested_at: "2026-10-01T00:00:00Z" })])).toMatchObject({ outcome_review_date: "2026-09-30", outcome_reviews_recorded: "1 of 3" });
    expect(outcomeColumns(base, [rr(30), rr(60), rr(90)])).toMatchObject({ outcome_review_date: null, outcome_reviews_recorded: "3 of 3" });
  });

  it("the latest value and adoption come from the latest recorded checkpoint that has them (numbers may arrive as text)", () => {
    const c = outcomeColumns(base, [rr(30, { realised_kr_value: "40", adoption_pct: "12.5" }), rr(60, { realised_kr_value: "70", adoption_pct: null })]);
    expect(c).toMatchObject({ realized_kr_value: 70, outcome_latest_adoption: 12.5 });
  });

  it("KR progress is (value - start) / (target - start) in percent, and empty when it cannot be worked out", () => {
    expect(outcomeColumns(base, [rr(30, { realised_kr_value: 60 })]).outcome_kr_progress).toBe(50);
    expect(outcomeColumns(row({ start_rollout: "2026-08-01", kr_start: 100, kr_target: 0 }), [rr(30, { realised_kr_value: 75 })]).outcome_kr_progress).toBe(25); // a metric that should go down
    expect(outcomeColumns(row({ start_rollout: "2026-08-01", kr_start: 5, kr_target: 5 }), [rr(30, { realised_kr_value: 7 })]).outcome_kr_progress).toBeNull();
    expect(outcomeColumns(row({ start_rollout: "2026-08-01" }), [rr(30, { realised_kr_value: 7 })]).outcome_kr_progress).toBeNull();
  });

  it("% Realized KR Value is the value over the target (the dictionary's own definition), and empty without a target or with a target of 0", () => {
    expect(outcomeColumns(base, [rr(30, { realised_kr_value: 55 })]).kr_realized_pct).toBe(50); // 55 of 110
    expect(outcomeColumns(row({ start_rollout: "2026-08-01", kr_start: 10, kr_target: 0 }), [rr(30, { realised_kr_value: 5 })]).kr_realized_pct).toBeNull();
    expect(outcomeColumns(row({ start_rollout: "2026-08-01" }), [rr(30, { realised_kr_value: 5 })]).kr_realized_pct).toBeNull();
  });

  describe("Outcome Status (default rule: on target from 80% of the way to the target, behind below, missed under 50% after the 90 day review, exceeded above 100%)", () => {
    const today = new Date("2026-11-19T09:00:00Z");
    const st = (o: Record<string, unknown>, reviews: OutcomeReview[]) => outcomeColumns(row({ start_rollout: "2026-08-01", kr_start: 0, kr_target: 100, ...o }), reviews, today).outcome_status;
    it("is Not yet due before the first review is due, and empty once it is due with nothing recorded", () => {
      expect(st({ start_rollout: "2026-11-10" }, [])).toBe("Not yet due");
      expect(st({}, [])).toBeNull(); // due 31 Aug and nothing recorded: there is no result to name
    });
    it("is Exceeded above 100%, On target from 80%, Behind below that", () => {
      expect(st({}, [rr(30, { realised_kr_value: 120 })])).toBe("Exceeded");
      expect(st({}, [rr(30, { realised_kr_value: 100 })])).toBe("On target");
      expect(st({}, [rr(30, { realised_kr_value: 80 })])).toBe("On target");
      expect(st({}, [rr(30, { realised_kr_value: 79 })])).toBe("Behind");
      expect(st({}, [rr(30, { realised_kr_value: 20 })])).toBe("Behind"); // Missed only after the 90 day review
    });
    it("is Missed under 50% once the 90 day review is recorded, and still Behind from 50%", () => {
      expect(st({}, [rr(30, { realised_kr_value: 10 }), rr(60, { realised_kr_value: 30 }), rr(90, { realised_kr_value: 40 })])).toBe("Missed");
      expect(st({}, [rr(30, { realised_kr_value: 10 }), rr(60, { realised_kr_value: 30 }), rr(90, { realised_kr_value: 55 })])).toBe("Behind");
    });
    it("works for a metric that should go down, and is empty without a start, a target or a value", () => {
      expect(st({ kr_start: 100, kr_target: 0 }, [rr(30, { realised_kr_value: 10 })])).toBe("On target"); // 90% of the way down
      expect(st({ kr_start: null }, [rr(30, { realised_kr_value: 50 })])).toBeNull();
      expect(st({}, [rr(30, { adoption_pct: 20, realised_kr_value: null })])).toBeNull();
    });
  });

  it("the six keys are read-only computed fields in the dictionary: three of the dictionary's own outcome fields, now live, and two in the Outcome reviews group", async () => {
    const { FIELD_BY_KEY } = await import("./index");
    for (const k of OUTCOME_COLUMN_KEYS) expect(FIELD_BY_KEY[k], k).toMatchObject({ mode: "computed", phase: 1 }); // Outcome Status too: computed from the reviews, not typed
    for (const k of ["outcome_reviews_recorded", "outcome_latest_adoption", "outcome_kr_progress"]) expect(FIELD_BY_KEY[k]!.group, k).toBe("Outcome reviews");
    for (const k of ["outcome_status", "outcome_review_date", "realized_kr_value", "kr_realized_pct"]) expect(FIELD_BY_KEY[k]!.group, k).toBe("Outcomes");
    expect(FIELD_BY_KEY.outcome_next_review).toBeUndefined(); // retired: it was Outcome Review Date
    expect(FIELD_BY_KEY.outcome_latest_value).toBeUndefined(); // retired: it was Realized KR Value
  });
});
