import { describe, expect, it } from "vitest";
import type { MoscowResult } from "@pv/domain";
import { moscowRows, planMoscow, type MoscowRow } from "./alignment-moscow";

const res = (itemId: string, suggested: MoscowResult["suggested"], tied = false): MoscowResult => ({ itemId, suggested, tied, contested: tied, counts: { must: 0, should: 0, could: 0, wont: 0 }, shares: { must: 0, should: 0, could: 0, wont: 0 } });
const rows: MoscowRow[] = [
  { itemId: "i1", code: "R-1", name: "One", current: null, suggested: "Must", tied: false, contested: false },
  { itemId: "i2", code: "R-2", name: "Two", current: "Could", suggested: "Should", tied: true, contested: true },
  { itemId: "i3", code: "R-3", name: "Three", current: "Won't", suggested: "Won't", tied: false, contested: false },
];
const seen = { i1: "", i2: "Could", i3: "Won't" };

describe("moscowRows", () => {
  it("joins the vote to the initiatives and counts those left out", () => {
    const out = moscowRows([res("a1", "must"), res("a2", "wont", true), res("a3", "could")], [{ id: "a1", item_id: "i1" }, { id: "a2", item_id: "i2" }, { id: "a3", item_id: "i3" }],
      [{ id: "i1", item_code: "R-1", initiative_name: "One", moscow: null, deleted_at: null }, { id: "i2", item_code: "R-2", initiative_name: "Two", moscow: "Could", deleted_at: null }, { id: "i3", item_code: "R-3", initiative_name: "Three", moscow: "Must", deleted_at: "2026-11-01" }]);
    expect(out.skipped).toBe(1);
    expect(out.rows.map((r) => [r.code, r.current, r.suggested, r.tied])).toEqual([["R-1", null, "Must", false], ["R-2", "Could", "Won't", true]]);
  });
});

describe("planMoscow", () => {
  it("sets the suggestion by default and overwrites what was there; an unchanged value is not a change", () => {
    const p = planMoscow(rows, ["i1", "i2", "i3"], seen);
    expect(p).toMatchObject({ ok: true, scope: "all", differing: [] });
    if (p.ok) expect(p.changes).toEqual([{ item: "i1", from: null, to: "Must" }, { item: "i2", from: "Could", to: "Should" }]);
  });
  it("only the ticked initiatives change", () => {
    const p = planMoscow(rows, ["i2"], seen);
    expect(p).toMatchObject({ ok: true, scope: "selection" });
    if (p.ok) expect(p.changes.map((c) => c.item)).toEqual(["i2"]);
  });
  it("a final value that differs from the suggestion needs a reason, which is trimmed", () => {
    expect(planMoscow(rows, ["i1"], seen, { i1: "Could" })).toEqual({ ok: false, reason: "reason-needed", ids: ["i1"] });
    const p = planMoscow(rows, ["i1"], seen, { i1: "Could" }, { i1: "  Not   this quarter  " });
    expect(p).toMatchObject({ ok: true, differing: ["i1"] });
    if (p.ok) expect(p.changes[0]).toEqual({ item: "i1", from: null, to: "Could", reason: "Not this quarter" });
  });
  it("refuses a stale view, a bad value, an empty choice and a no-op", () => {
    expect(planMoscow(rows, ["i2"], { ...seen, i2: "Must" })).toEqual({ ok: false, reason: "stale" });
    expect(planMoscow(rows, ["i1"], seen, { i1: "Maybe" })).toEqual({ ok: false, reason: "bad-value" });
    expect(planMoscow(rows, [], seen)).toEqual({ ok: false, reason: "pick-one" });
    expect(planMoscow(rows, ["i3"], seen)).toEqual({ ok: false, reason: "nothing" });
  });
});
