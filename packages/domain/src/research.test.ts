import { describe, expect, it } from "vitest";
import type { MemoryRow } from "./memory";
import { researchGaps } from "./research";

const NOW = new Date("2026-10-30T00:00:00Z");
const note = (o: Partial<MemoryRow>): MemoryRow => ({
  id: "m", scope: "workspace", group: null, item: null, kind: "partner", title: "Acme Pay", body: "Card payments.", source: "https://acme.example", basis: "source", tags: [], status: "draft",
  ai_draft: true, version: 1, verified_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", assistant: "chatgpt", ...o,
});

describe("researchGaps", () => {
  it("is known when a fresh note is titled with it, stale when the note is older than 90 days, missing otherwise", () => {
    const g = researchGaps(["Acme Pay", "Globex", "Initech"], [note({}), note({ id: "x", title: "Globex", verified_at: "2026-05-01T00:00:00Z" })], null, NOW);
    expect(g.map((x) => [x.term, x.status])).toEqual([["Acme Pay", "known"], ["Globex", "stale"], ["Initech", "missing"]]);
    expect(g[0]!.hits[0]).toMatchObject({ where: "memory", id: "m", days_old: 29, stale: false });
  });
  it("a body-only mention is listed but does not make a term known", () => {
    const g = researchGaps(["acquirer"], [note({ title: "Payments", body: "We use an acquirer for cards." })], null, NOW);
    expect(g[0]).toMatchObject({ status: "missing" });
    expect(g[0]!.hits).toHaveLength(1);
  });
  it("reads the company profile's partners and glossary, and its age", () => {
    const profile = { sections: { partners: "Globex: logistics platform.", glossary: "Churn: lost accounts." }, researched_at: "2026-10-10T00:00:00Z" };
    const g = researchGaps(["Globex", "churn", "Hooli"], [], profile, NOW);
    expect(g.map((x) => x.status)).toEqual(["known", "known", "missing"]);
    const old = researchGaps(["Globex"], [], { ...profile, researched_at: "2026-01-01T00:00:00Z" }, NOW);
    expect(old[0]!.status).toBe("stale");
  });
  it("ignores archived notes, matches whole words only, and cuts long lists", () => {
    expect(researchGaps(["Acme"], [note({ status: "archived" })], null, NOW)[0]!.status).toBe("missing");
    expect(researchGaps(["Pay"], [note({ title: "Payment rails" })], null, NOW)[0]!.status).toBe("missing");
    expect(researchGaps(Array.from({ length: 30 }, (_, i) => `t${i}`), [], null, NOW)).toHaveLength(20);
  });
});
