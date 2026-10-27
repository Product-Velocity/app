import { describe, expect, it } from "vitest";
import { FIELDS } from "./registry";
import { activityEvents, canUndoActivity, panelField, panelSections, type ActivityRow } from "./panel";

const f = (key: string) => FIELDS.find((x) => x.key === key)!;

describe("panelField: how each of the 169 fields is shown in the item panel", () => {
  it("scalar editable fields get their own editor", () => {
    expect(panelField(f("initiative_name")).kind).toBe("text");
    expect(panelField(f("hypothesis")).kind).toBe("longtext");
    expect(panelField(f("value_12m")).kind).toBe("currency");
    expect(panelField(f("start_date")).kind).toBe("date");
    expect(panelField(f("moscow")).kind).toBe("select");
    expect(panelField(f("product_manager")).kind).toBe("person");
    expect(panelField(f("home_project")).kind).toBe("project");
    expect(panelField(f("theme")).kind).toBe("group");
    expect(panelField(f("stack_rank")).kind).toBe("rank");
  });
  it("tags, links, relations, teams and skills have typed editors; screenshots are a file list", () => {
    for (const k of ["tags", "target_scope", "live_scope", "target_segments"]) expect(panelField(f(k)).kind, k).toBe("tags");
    expect(panelField(f("artifacts")).kind).toBe("links");
    expect(panelField(f("depends_on")).kind).toBe("relations");
    expect(panelField(f("related_to")).kind).toBe("relations");
    expect(panelField(f("contributing_teams")).kind).toBe("teams");
    expect(panelField(f("effort_by_skill")).kind).toBe("skills");
    expect(panelField(f("screenshots"))).toEqual({ kind: "files" });
  });
  it("locked, calculated and system fields say why they cannot be edited", () => {
    expect(panelField(f("status"))).toMatchObject({ kind: "readonly", reason: expect.stringContaining("comes from GitHub") });
    expect(panelField(f("value_weighted"))).toMatchObject({ kind: "readonly", reason: expect.stringContaining("calculated") });
    expect(panelField(f("item_code"))).toMatchObject({ kind: "readonly", reason: expect.stringContaining("set by the system") });
  });
  it("fields of later phases are shown as arriving, not hidden", () => {
    expect(panelField(f("outcome_verdict"))).toMatchObject({ kind: "later", phase: 7, reason: "Arrives in phase 7." });
    expect(panelField(f("documents")).kind).toBe("later");
  });
  it("every field gets exactly one kind and every shipped editable field has an editor", () => {
    for (const x of FIELDS) {
      const p = panelField(x);
      expect(p.kind, x.key).toBeTruthy();
      if (x.editable && x.phase <= 1 && x.key !== "screenshots") expect(["readonly", "later"], x.key).not.toContain(p.kind);
    }
  });
});

describe("panelSections", () => {
  it("lists all 169 fields once, in the sheet's group order", () => {
    const s = panelSections();
    expect(s.map((x) => x.group).slice(0, 4)).toEqual(["What", "Who", "Why", "Decision"]);
    expect(s.flatMap((x) => x.fields).map((x) => x.key).sort()).toEqual(FIELDS.map((x) => x.key).sort());
  });
  it("marks a group whose fields all arrive later, so it can start collapsed", () => {
    const s = panelSections();
    expect(s.find((x) => x.group === "Gates")!.allLater).toBe(true);
    expect(s.find((x) => x.group === "What")!.allLater).toBe(false);
  });
});

const at = (s: string) => `2027-04-14T10:${s}:00Z`;
let n = 0;
const row = (o: Partial<ActivityRow>): ActivityRow => ({ id: ++n, at: at("00"), entity: "items", entityId: "i1", field: "health", old: null, new: null, actorId: "u1", via: "UI", ...o });

describe("activityEvents", () => {
  it("turns an item field change into one event with the dictionary label and the column mapped to its key", () => {
    const [e] = activityEvents([row({ field: "owner_user_id", old: "u1", new: "u2" })]);
    expect(e).toMatchObject({ kind: "changed", field: "product_manager", label: "Product Manager", entity: "items", old: "u1", new: "u2" });
  });
  it("hides housekeeping columns", () => {
    expect(activityEvents([row({ field: "updated_at" }), row({ field: "created_by" }), row({ field: "tenant_id" })])).toEqual([]);
  });
  it("groups the field rows of a related row (added tag) into one event", () => {
    const base = { entity: "item_tags", entityId: "t1", at: at("05") };
    const ev = activityEvents([
      row({ ...base, field: "id", new: "t1" }), row({ ...base, field: "item_id", new: "i1" }),
      row({ ...base, field: "kind", new: "tag" }), row({ ...base, field: "value", new: "urgent" }),
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "added", field: "tags", label: "Tags", detail: "urgent" });
  });
  it("shows a removed link and a changed relation in words", () => {
    const rem = activityEvents([
      row({ entity: "item_links", entityId: "l1", field: "url", old: "https://x.test/prd", new: null }),
      row({ entity: "item_links", entityId: "l1", field: "label", old: "PRD", new: null }),
    ]);
    expect(rem[0]).toMatchObject({ kind: "removed", field: "artifacts", detail: "PRD (https://x.test/prd)" });
    const rel = activityEvents([
      row({ entity: "item_relations", entityId: "r1", field: "kind", new: "depends_on" }),
      row({ entity: "item_relations", entityId: "r1", field: "related_item_id", new: "i9" }),
    ]);
    expect(rel[0]).toMatchObject({ kind: "added", field: "depends_on", detail: "i9" });
  });
  it("keeps newest first", () => {
    const ev = activityEvents([row({ at: at("01"), field: "health", new: "At Risk" }), row({ at: at("09"), field: "effort", new: "M" })]);
    expect(ev.map((e) => e.field)).toEqual(["effort", "health"]);
  });
});

describe("canUndoActivity", () => {
  const ev = (o: Record<string, unknown>) => ({ kind: "changed", entity: "items", field: "health", old: "On Track", new: "At Risk", actorId: "u1", ...o }) as Parameters<typeof canUndoActivity>[0];
  it("only your own change to an item field that still has the value it set", () => {
    expect(canUndoActivity(ev({}), "u1", "At Risk")).toEqual({ ok: true });
    expect(canUndoActivity(ev({}), "u2", "At Risk")).toEqual({ ok: false, reason: "You can only undo your own changes." });
    expect(canUndoActivity(ev({}), "u1", "Delayed")).toEqual({ ok: false, reason: "The value has changed since. Undo the newer change first." });
  });
  it("related-row changes are undone with Undo in the panel, not from the log; GitHub and Claude changes are not yours", () => {
    expect(canUndoActivity(ev({ entity: "item_tags" }), "u1", null).ok).toBe(false);
    expect(canUndoActivity(ev({ kind: "added" }), "u1", null).ok).toBe(false);
    expect(canUndoActivity(ev({ via: "GitHub webhook" }), "u1", "At Risk")).toMatchObject({ ok: false });
  });
});

describe("activity of a delete and a restore", () => {
  const row = (id: number, field: string, old: unknown, value: unknown) => ({ id, at: `2027-04-14T10:00:0${id}Z`, entity: "items", entityId: "i1", field, old, new: value, actorId: "u1", via: "UI" });
  it("says moved to the Trash and restored from the Trash, and hides who deleted it", () => {
    const events = activityEvents([row(1, "deleted_at", null, "2027-04-14T10:00:01Z"), row(2, "deleted_by", null, "u1"), row(3, "deleted_at", "2027-04-14T10:00:01Z", null), row(4, "deleted_by", "u1", null)]);
    expect(events.map((e) => e.label)).toEqual(["Restored from the Trash", "Moved to the Trash"]);
  });
});
