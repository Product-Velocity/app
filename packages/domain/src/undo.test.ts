import { describe, expect, it } from "vitest";
import { describeEdit, UndoStack, type Entry } from "./undo";

const entry = (n: number): Entry => ({
  id: `e${n}`,
  edits: [{ type: "field", itemId: `i${n}`, key: `R-${n}`, field: "initiative_name", before: `a${n}`, after: `b${n}` }],
});

describe("UndoStack", () => {
  it("undoes in reverse order and redoes in order", () => {
    const s = new UndoStack(20);
    s.push(entry(1)); s.push(entry(2)); s.push(entry(3));
    expect(s.undo()?.id).toBe("e3");
    expect(s.undo()?.id).toBe("e2");
    expect(s.redo()?.id).toBe("e2");
    expect(s.redo()?.id).toBe("e3");
    expect(s.redo()).toBeNull();
  });

  it("keeps only the last 20 changes", () => {
    const s = new UndoStack(20);
    for (let i = 1; i <= 25; i++) s.push(entry(i));
    expect(s.undoCount).toBe(20);
    let last = "";
    for (let i = 0; i < 30; i++) { const e = s.undo(); if (e) last = e.id; }
    expect(last).toBe("e6"); // e1..e5 fell off
    expect(s.undo()).toBeNull();
  });

  it("a new change clears the redo list", () => {
    const s = new UndoStack(20);
    s.push(entry(1)); s.push(entry(2));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.push(entry(3));
    expect(s.canRedo).toBe(false);
    expect(s.undo()?.id).toBe("e3");
    expect(s.undo()?.id).toBe("e1");
  });

  it("can put an entry back when applying it failed", () => {
    const s = new UndoStack(20);
    s.push(entry(1)); s.push(entry(2));
    const e = s.undo()!;
    s.restoreUndo(e); // the inverse write failed or was skipped
    expect(s.undo()?.id).toBe("e2");
  });

  it("drops an entry whose save failed, so it cannot be undone later", () => {
    const s = new UndoStack(20);
    const a = entry(1), b = entry(2);
    s.push(a); s.push(b);
    s.discard(b);
    expect(s.undoCount).toBe(1);
    expect(s.undo()?.id).toBe("e1");
    s.discard(entry(9)); // unknown entry: nothing happens
    expect(s.canRedo).toBe(true);
  });

  it("treats a multi-edit entry as one step", () => {
    const s = new UndoStack(20);
    s.push({ id: "bulk", edits: [entry(1).edits[0]!, entry(2).edits[0]!] });
    expect(s.undoCount).toBe(1);
    expect(s.undo()?.edits).toHaveLength(2);
  });

  it("reports sizes and clears", () => {
    const s = new UndoStack(20);
    s.push(entry(1));
    expect([s.canUndo, s.canRedo]).toEqual([true, false]);
    s.clear();
    expect([s.canUndo, s.canRedo]).toEqual([false, false]);
  });
});

describe("describeEdit", () => {
  const labels = { project: (id: string) => `Project ${id}`, owner: (id: string) => `Owner ${id}` };
  it("says what changed in plain words", () => {
    expect(describeEdit({ type: "field", itemId: "i", key: "R-41", field: "health", before: "On Track", after: "At Risk" }, labels)).toBe("R-41 Health: On Track to At Risk");
    expect(describeEdit({ type: "field", itemId: "i", key: "R-07", field: "initiative_name", before: "Old", after: "New name" }, labels)).toBe("R-07 Initiative Name: Old to New name");
    expect(describeEdit({ type: "field", itemId: "i", key: "R-07", field: "value_12m", before: null, after: 120000 }, labels)).toBe("R-07 Business Value (12m run-rate): empty to 120,000");
    expect(describeEdit({ type: "field", itemId: "i", key: "R-07", field: "start_date", before: "2027-03-31", after: null }, labels)).toMatch(/R-07 Start Date: .* to empty/);
    expect(describeEdit({ type: "field", itemId: "i", key: "R-07", field: "home_project", before: "p1", after: "p2" }, labels)).toBe("R-07 Home Project: Project p1 to Project p2");
    const draft = { initiative_name: "Faster search", home_project: "p1", product_manager: null, effort: null, moscow: null };
    expect(describeEdit({ type: "create", itemId: "i", key: "R-12", draft }, labels)).toBe('Added R-12 "Faster search"');
    expect(describeEdit({ type: "create", itemId: "i", key: "…", draft }, labels)).toBe('Added "Faster search"');
    expect(describeEdit({ type: "rank", itemId: "i", key: "R-07", before: 7, after: 2 }, labels)).toBe("R-07 moved from rank 7 to 2");
  });
});

describe("describeEdit of list fields (tags, links, relations, teams)", () => {
  const labels = { project: (id: string) => id, owner: (id: string) => id };
  it("says what was added and removed, in words", () => {
    expect(describeEdit({ type: "related", itemId: "i", key: "R-12", field: "tags", before: ["a"], after: ["a", "urgent"] }, labels)).toBe("R-12 Tags: added urgent");
    expect(describeEdit({ type: "related", itemId: "i", key: "R-12", field: "tags", before: ["a", "b"], after: ["b"] }, labels)).toBe("R-12 Tags: removed a");
    expect(describeEdit({ type: "related", itemId: "i", key: "R-12", field: "target_segments", before: ["a"], after: ["b"] }, labels)).toBe("R-12 Target Segments (customer-safe): added b, removed a");
    expect(describeEdit({ type: "related", itemId: "i", key: "R-12", field: "artifacts", before: [], after: [{ label: "PRD", url: "https://x.test/p" }] }, labels)).toBe("R-12 Artifacts (links): added PRD");
  });
});

describe("describeEdit with long text", () => {
  const r = { project: (id: string) => id, owner: (id: string) => id };
  it("shortens a long value so the status line stays one line, and keeps short values whole", () => {
    const long = "## Goal\n\n" + "word ".repeat(200);
    const text = describeEdit({ type: "field", itemId: "i", key: "R-03", field: "description", before: null, after: long }, r);
    expect(text.length).toBeLessThan(120);
    expect(text).toContain("R-03 Description: empty to ## Goal word");
    expect(text).toMatch(/… \(1,007 characters\)$/);
    expect(describeEdit({ type: "field", itemId: "i", key: "R-03", field: "hypothesis", before: null, after: "IF x THEN y" }, r)).toBe("R-03 Initiative Hypothesis (IF / THEN / RESULTING IN): empty to IF x THEN y");
  });
});
