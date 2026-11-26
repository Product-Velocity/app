import { describe, expect, it } from "vitest";
import { PortfolioController } from "./controller";
import { MemoryDataSource, sampleItems } from "./memory-source";
import { peopleOf, personLabel, personName, personOptions, selectablePeople } from "./people";
import type { Lookups } from "./types";

// Issue #691: people named without an account can be chosen on a person field.
const TODAY = new Date(Date.UTC(2027, 3, 14));
function setup(role = "creator") {
  const lookups: Lookups = {
    projects: [{ id: "p1", name: "Platform" }],
    members: [{ user_id: "u1", email: "ana@example.test" }],
    people: [
      { id: "u1", name: "ana@example.test", email: "ana@example.test", status: "active", userId: "u1" },
      { id: "pe1", name: "Jane Doe", email: "jane@example.test", status: "not_invited", userId: null },
    ],
    mePerson: "p-linked",
  };
  const items = sampleItems(3, ["p1"], ["u1"]);
  const source = new MemoryDataSource(items);
  const c = new PortfolioController(source, items, lookups, role, () => TODAY, () => 1_000, undefined, "u1");
  return { c, source, lookups };
}

describe("people of a workspace", () => {
  it("falls back to the members when there is no directory", () => {
    expect(peopleOf({ members: [{ user_id: "u1", email: "a@x.test" }] })).toEqual([{ id: "u1", name: "a@x.test", email: "a@x.test", status: "active", userId: "u1" }]);
  });
  it("says in the picker who has not been invited, and nowhere else", () => {
    const { lookups } = setup();
    expect(personOptions(lookups)).toEqual([{ value: "u1", label: "ana@example.test" }, { value: "pe1", label: "Jane Doe (not invited)" }]);
    expect(personLabel({ id: "x", name: "Ravi", email: null, status: "invited", userId: null })).toBe("Ravi (invited)");
    expect(personName(lookups, "pe1")).toBe("Jane Doe");
    expect(personName(lookups, "gone")).toBe("unknown person");
  });
});

describe("a person named without an account", () => {
  it("can be Product Manager: the cell shows the name and the save carries the person id", async () => {
    const { c, source } = setup();
    expect(c.edit("item-1", "product_manager", "pe1")).toEqual({ ok: true, changed: true });
    await c.flush();
    expect(source.calls.at(-1)).toMatchObject({ type: "update", field: "product_manager", value: "pe1" });
  });

  it("is added from a typed name, then chosen: one new person, one undo step", async () => {
    const { c, source, lookups } = setup();
    c.editPerson("item-1", "engineering_manager", "Ravi Rao <ravi@example.test>");
    await c.flush();
    await new Promise((r) => setTimeout(r, 0));
    await c.flush();
    expect(source.addedPeople).toEqual([{ name: "Ravi Rao", email: "ravi@example.test" }]);
    expect(lookups.people!.map((p) => p.name)).toContain("Ravi Rao");
    expect(c.row("item-1")!.engineering_manager).toBe("person-1");
    expect(c.status.canUndo).toBe(true);
  });

  it("is not added twice: a typed name or address already on the list gives that person back", async () => {
    const { c, source } = setup();
    const r = await c.addPerson("jane doe");
    expect(r).toMatchObject({ ok: true, added: false, person: { id: "pe1" } });
    const r2 = await c.addPerson("JANE@example.test");
    expect(r2).toMatchObject({ ok: true, added: false, person: { id: "pe1" } });
    expect(source.addedPeople).toEqual([]);
  });

  it("an id from the list or an empty value is an ordinary edit and adds nobody", async () => {
    const { c, source } = setup();
    c.editPerson("item-1", "designer", "pe1");
    c.editPerson("item-1", "designer", "");
    await c.flush();
    expect(source.addedPeople).toEqual([]);
    expect(c.row("item-1")!.designer).toBeNull();
  });

  it("says why when the person could not be added, and changes nothing", async () => {
    const { c, source } = setup();
    source.failPerson = "Someone with that email is on the list already";
    const r = await c.addPerson("Someone <new@example.test>");
    expect(r).toEqual({ ok: false, error: "Someone with that email is on the list already" });
    expect(c.status.notice).toContain("Could not add Someone");
  });

  it("typing a member's address gives back that member instead of adding a second person", async () => {
    const { c, source } = setup();
    expect(await c.addPerson("Ana <ana@example.test>")).toMatchObject({ ok: true, added: false, person: { id: "u1" } });
    expect(source.addedPeople).toEqual([]);
  });

  it("a viewer cannot add people", async () => {
    const { c, source } = setup("viewer");
    expect((await c.addPerson("Nope")).ok).toBe(false);
    expect(source.addedPeople).toEqual([]);
  });
});

describe('"me" in filters', () => {
  it("is the person of the signed-in user, which differs from the user id for someone named before they joined", () => {
    const { c } = setup();
    expect(c.mePerson()).toBe("p-linked");
    expect(c.mePerson("u9")).toBe("p-linked");
  });
  it("falls back to the user id when the directory does not say", () => {
    const items = sampleItems(1, ["p1"], ["u1"]);
    const c = new PortfolioController(new MemoryDataSource(items), items, { projects: [], members: [] }, "creator", () => TODAY, () => 1_000, undefined, "u1");
    expect(c.mePerson()).toBe("u1");
  });
});

describe("reports and splits by a person named without an account", () => {
  it("count initiatives per person id, and the report names them from the people list", async () => {
    const { shareOf, stackCounts } = await import("@pv/domain");
    const { lookups } = setup();
    const rows = [
      { product_manager: "pe1", engineering_manager: "u1", initiative_phase: "Build" },
      { product_manager: "pe1", engineering_manager: null, initiative_phase: "Define" },
      { product_manager: "u1", engineering_manager: "pe1", initiative_phase: "Build" },
    ] as never[];
    const share = shareOf(rows, "product_manager");
    expect(Object.fromEntries(share.map((s: { key: string; count: number }) => [s.key, s.count]))).toEqual({ pe1: 2, u1: 1 });
    expect(share.map((s: { key: string }) => personName(lookups, s.key))).toEqual(expect.arrayContaining(["Jane Doe", "ana@example.test"]));
    const stacked = stackCounts(rows, "product_manager", "initiative_phase");
    expect(JSON.stringify(stacked)).toContain("pe1");
  });
});

describe("members who are paused, revoked or only asked for access (issue #698)", () => {
  const lookups: Lookups = {
    projects: [],
    members: [{ user_id: "u1", email: "ana@example.test" }],
    people: [
      { id: "u1", name: "ana@example.test", email: "ana@example.test", status: "active", userId: "u1" },
      { id: "u2", name: "bo@example.test", email: "bo@example.test", status: "paused", userId: "u2" },
      { id: "u3", name: "cy@example.test", email: "cy@example.test", status: "revoked", userId: "u3" },
      { id: "u4", name: "di@example.test", email: "di@example.test", status: "requested", userId: "u4" },
      { id: "pe1", name: "Jane Doe", email: null, status: "not_invited", userId: null },
      { id: "pe2", name: "Ravi Rao", email: null, status: "invited", userId: null },
    ],
  };
  it("keep their name wherever a person field is shown", () => {
    for (const id of ["u2", "u3", "u4"]) expect(personName(lookups, id)).not.toBe("unknown person");
    expect(personName(lookups, "u2")).toBe("bo@example.test");
  });
  it("are not offered by a picker, quick add, a paste import or Claude, but are in a filter or a report", () => {
    expect(selectablePeople(lookups).map((p) => p.id)).toEqual(["u1", "pe1", "pe2"]);
    expect(personOptions(lookups).map((o) => o.value)).toEqual(["u1", "pe1", "pe2"]);
    expect(personOptions(lookups, { all: true }).map((o) => o.label)).toEqual([
      "ana@example.test", "bo@example.test (paused)", "cy@example.test (revoked)", "di@example.test (requested access)", "Jane Doe (not invited)", "Ravi Rao (invited)",
    ]);
  });
});

