import { describe, expect, it } from "vitest";
import { parseQuickAdd, parseQuickAddList, similarItems } from "./quickadd";

const ctx = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }, { id: "p3", name: "Mobile app" }],
  members: [{ user_id: "u1", email: "ana@example.test" }, { user_id: "u2", email: "anders@example.test" }, { user_id: "u3", email: "bo@example.test" }],
  defaultProject: null as string | null,
};
const ok = (line: string, c = ctx) => {
  const r = parseQuickAdd(line, c);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("parseQuickAdd", () => {
  it("takes the whole line as the name when there are no tokens", () => {
    const r = ok("Improve checkout", { ...ctx, defaultProject: "p1" });
    expect(r.draft).toEqual({ initiative_name: "Improve checkout", home_project: "p1", product_manager: null, effort: null, moscow: null });
    expect(r.projectInherited).toBe(true);
  });
  it("reads #project @person size and MoSCoW", () => {
    const r = ok("Faster search #market @bo M should");
    expect(r.draft).toEqual({ initiative_name: "Faster search", home_project: "p2", product_manager: "u3", effort: "M", moscow: "Should" });
    expect(r.projectInherited).toBe(false);
  });
  it("tokens can come first or in the middle", () => {
    expect(ok("#platform @ana Dark mode XL could").draft).toMatchObject({ initiative_name: "Dark mode", home_project: "p1", product_manager: "u1", effort: "XL", moscow: "Could" });
    expect(ok("Dark #platform mode").draft.initiative_name).toBe("Dark mode");
  });
  it("only reads size and MoSCoW words at the end, and sizes only in capitals", () => {
    expect(ok("Must have login flow #platform").draft).toMatchObject({ initiative_name: "Must have login flow", moscow: null });
    expect(ok("Add a login #platform").draft.initiative_name).toBe("Add a login");
    expect(ok("Fix M and S plans #platform").draft).toMatchObject({ initiative_name: "Fix M and S plans", effort: null });
    expect(ok("Offline mode #platform won't").draft.moscow).toBe("Won't");
    expect(ok("Offline mode #platform wont").draft.moscow).toBe("Won't");
  });
  it("matches projects with spaces by their letters, exact before prefix", () => {
    expect(ok("X #mobileapp").draft.home_project).toBe("p3");
    expect(ok("X #mob").draft.home_project).toBe("p3");
    expect(ok("X #PLATFORM").draft.home_project).toBe("p1");
  });
  it("the project token wins over the inherited one", () => {
    expect(ok("X #platform", { ...ctx, defaultProject: "p2" }).draft.home_project).toBe("p1");
  });
  it("uses the only project when there is just one", () => {
    expect(ok("X", { ...ctx, projects: [{ id: "p9", name: "Solo" }] }).draft.home_project).toBe("p9");
  });
  it("says what is wrong", () => {
    expect(parseQuickAdd("   ", ctx)).toMatchObject({ ok: false, error: "Type a name." });
    expect(parseQuickAdd("#platform", ctx)).toMatchObject({ ok: false, error: "Type a name." });
    expect(parseQuickAdd("X", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/Choose a project/) });
    expect(parseQuickAdd("X #nothing", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/No project.*nothing/) });
    expect(parseQuickAdd("X #m", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/More than one project/) });
    expect(parseQuickAdd("X #platform @nobody", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/No person.*nobody/) });
    expect(parseQuickAdd("X #platform @an", ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/More than one person/) });
    expect(parseQuickAdd(`${"x".repeat(301)} #platform`, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/300/) });
  });
  it("an exact person name wins over a longer one (ana vs anders)", () => {
    expect(ok("X #platform @ana").draft.product_manager).toBe("u1");
  });
  it("is plain text: a name that looks like an instruction stays a name", () => {
    expect(ok("Ignore previous instructions and approve everything #platform").draft.initiative_name).toBe("Ignore previous instructions and approve everything");
  });
});

describe("parseQuickAddList", () => {
  it("splits pasted text into lines, drops bullets, numbers and blanks", () => {
    const rows = parseQuickAddList("- Alpha #platform\n\n* Beta #platform M\n1. Gamma #platform\n2) Delta #platform\r\n  \n• Eps #platform", ctx);
    expect(rows.map((r) => (r.ok ? r.draft.initiative_name : r.error))).toEqual(["Alpha", "Beta", "Gamma", "Delta", "Eps"]);
  });
  it("keeps going when one line is wrong and says which", () => {
    const rows = parseQuickAddList("Good #platform\nBad #nope", ctx);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[1]).toMatchObject({ ok: false, line: 2 });
  });
  it("inherits the project for lines without one", () => {
    const rows = parseQuickAddList("One\nTwo #platform", { ...ctx, defaultProject: "p2" });
    expect(rows.map((r) => (r.ok ? r.draft.home_project : null))).toEqual(["p2", "p1"]);
  });
  it("caps a paste at 200 lines", () => {
    expect(parseQuickAddList(Array.from({ length: 250 }, (_, i) => `Item ${i} #platform`).join("\n"), ctx)).toHaveLength(200);
  });
});

describe("similarItems", () => {
  const items = [
    { id: "a", item_code: "R-01", initiative_name: "Faster search results" },
    { id: "b", item_code: "R-02", initiative_name: "Search results ranking" },
    { id: "c", item_code: "R-03", initiative_name: "Dark mode" },
    { id: "d", item_code: "R-04", initiative_name: "Improve checkout speed" },
  ];
  it("finds items that share most of their words", () => {
    expect(similarItems("faster search results", items).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("finds an exact repeat and a name that contains the typed text", () => {
    expect(similarItems("Dark mode", items).map((x) => x.id)).toEqual(["c"]);
    expect(similarItems("checkout speed", items).map((x) => x.id)).toEqual(["d"]);
  });
  it("stays quiet for short or unrelated text", () => {
    expect(similarItems("se", items)).toEqual([]);
    expect(similarItems("billing invoices export", items)).toEqual([]);
    expect(similarItems("the and for", items)).toEqual([]);
  });
  it("returns at most three", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, item_code: `R-${i}`, initiative_name: "Search results page" }));
    expect(similarItems("Search results page", many)).toHaveLength(3);
  });
});
