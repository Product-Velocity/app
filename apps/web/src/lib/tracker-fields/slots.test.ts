import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import { OUTBOUND_ITEM_FIELDS, BOARD_ONLY_FIELDS } from "@pv/github";
import { describe, expect, it } from "vitest";
import { OUTBOUND_JIRA_FIELDS } from "@/lib/atlassian/outbound";
import { FROM_TRACKER, NEVER_SYNCED, SLOTS, TWO_WAY, knownKey, mappingRows, slotsFor, type Tracker } from "./slots";

const TRACKERS: Tracker[] = ["github", "jira"];

describe("the default mapping covers the whole dictionary", () => {
  it.each(TRACKERS)("%s: every one of the 170 fields has at least one row, in dictionary order", (t) => {
    const rows = mappingRows(t);
    expect(FIELDS).toHaveLength(170);
    expect([...new Set(rows.map((r) => r.key))]).toEqual(FIELDS.map((f) => f.key));
    for (const r of rows) expect(r.label).toBe(FIELD_BY_KEY[r.key]!.name);
  });
  it("every key named by a classification or a slot is a dictionary field", () => {
    for (const k of NEVER_SYNCED) expect(knownKey(k), k).toBe(true);
    for (const t of TRACKERS) for (const k of [...FROM_TRACKER[t].keys(), ...TWO_WAY[t].keys()]) expect(knownKey(k), `${t} ${k}`).toBe(true);
    for (const s of SLOTS) expect(knownKey(s.pvKey), s.id).toBe(true);
  });
  it("slot ids are unique and start with their tracker", () => {
    expect(new Set(SLOTS.map((s) => s.id)).size).toBe(SLOTS.length);
    for (const s of SLOTS) expect(s.id.startsWith(`${s.tracker}.`), s.id).toBe(true);
  });
});

describe("hard boundaries (rules 2 and 6)", () => {
  it("every field the dictionary marks 'Never synced' is a Never synced row, and no slot can name a commercial field", () => {
    for (const f of FIELDS) if (/^never synced/i.test(f.githubSync ?? "")) expect(NEVER_SYNCED.has(f.key), f.key).toBe(true);
    for (const s of SLOTS) expect(NEVER_SYNCED.has(s.pvKey), s.id).toBe(false);
    for (const t of TRACKERS) for (const r of mappingRows(t).filter((x) => NEVER_SYNCED.has(x.key))) expect(r).toMatchObject({ direction: "never", slot: null });
  });
  it("the commercial fields named by rule 2 are all in the list", () => {
    for (const k of ["value_12m", "confidence", "customers_requesting", "customers_live", "target_customers", "decision", "decided_by", "cost_of_not_doing", "kr_metric", "kr_target", "realized_kr_value", "outcome_verdict", "learning"]) expect(NEVER_SYNCED.has(k), k).toBe(true);
  });
  it("tracker-driven fields are read-only in the app and have no slot; Initiative Status is never tracker-driven", () => {
    for (const t of TRACKERS) {
      for (const k of FROM_TRACKER[t].keys()) {
        expect(FIELD_BY_KEY[k]!.editable, `${t} ${k}`).toBe(false);
        expect(slotsFor(t).some((s) => s.pvKey === k), `${t} ${k} has a slot`).toBe(false);
      }
      expect(FROM_TRACKER[t].has("initiative_status")).toBe(false);
      expect(mappingRows(t).filter((r) => r.key === "initiative_status").every((r) => r.direction === "not_synced")).toBe(true);
    }
  });
  it("only allowlisted fields have a slot that sends (the same lists the payload builders read)", () => {
    const github = new Set<string>([...OUTBOUND_ITEM_FIELDS, ...BOARD_ONLY_FIELDS, "home_project", "screenshots", "artifacts", "assignees"]);
    const jira = new Set<string>([...OUTBOUND_JIRA_FIELDS, "home_project", "artifacts", "screenshots"]);
    for (const s of SLOTS) expect((s.tracker === "github" ? github : jira).has(s.pvKey), s.id).toBe(true);
  });
});

describe("the defaults describe what Sync does today", () => {
  const row = (t: Tracker, key: string) => mappingRows(t).filter((r) => r.key === key);
  it("Jira: name and description both ways, the rest to Jira, status and children counts from Jira", () => {
    expect(row("jira", "initiative_name")[0]).toMatchObject({ direction: "two_way", target: "Summary" });
    expect(row("jira", "g2m_date_est")[0]).toMatchObject({ direction: "to_tracker", target: "Due date (duedate)" });
    expect(row("jira", "moscow").map((r) => r.slot!.id)).toEqual(["jira.label.moscow", "jira.priority"]);
    expect(row("jira", "status")[0]!.direction).toBe("from_tracker");
    expect(row("jira", "open_prs")[0]!.direction).toBe("not_synced");
    expect(row("jira", "summary")[0]).toMatchObject({ direction: "two_way", target: "Description, section Summary" }); // issue #319: sections like the GitHub block
    expect(row("jira", "artifacts")[0]!.slot!.id).toBe("jira.body.artifacts");
  });
  it("GitHub: the issue block both ways, labels and board values to GitHub, delivery from GitHub", () => {
    expect(row("github", "hypothesis")[0]).toMatchObject({ direction: "two_way" });
    expect(row("github", "g2m_date_est").map((r) => r.slot!.id)).toEqual(["github.milestone", "github.board.dueDate"]);
    expect(row("github", "effort")[0]!.slot!.id).toBe("github.board.size");
    expect(row("github", "open_prs")[0]!.direction).toBe("from_tracker");
    expect(row("github", "planned_start")[0]!.direction).toBe("not_synced");
  });
});
