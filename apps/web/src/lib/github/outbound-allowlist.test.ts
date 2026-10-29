import { describe, expect, it } from "vitest";
import { buildTrackingIssue, MemorySourceControl, OUTBOUND_READ_FIELDS, pushTrackingIssue } from "@pv/github";
import { FIELDS } from "@pv/domain";

// CLAUDE.md rule 2, issue #33: commercial fields never reach GitHub. Every one of the 165 dictionary fields gets a unique
// sentinel value; only the allowlisted ones may appear anywhere in what would be sent. This test cannot be skipped: it is
// part of `pnpm test`, which CI runs.
const ID = "22222222-2222-4222-8222-222222222222";
const allowed = new Set<string>(OUTBOUND_READ_FIELDS);
// read, but only ever sent as a label (MoSCoW value, rank band, Change Type), an issue type or a milestone (G2M date), never as text: they are checked with real values below
const DERIVED = new Set(["moscow", "stack_rank", "change_type", "g2m_date_est", "theme", "effort"]);
const sentinel = (key: string) => `LEAK_${key.toUpperCase()}_9f3a`;

/**
 * Every tracker the app can write to is listed here with a way to capture exactly what it would send for an item. A new provider (Jira)
 * is added to this list, and then the same leak checks below run against it: no commercial field in any outbound payload (rule 2).
 */
type OutboundProvider = { name: string; wire: (item: Record<string, unknown>, artifacts: { label: string; url: string }[]) => Promise<string> };
const OUTBOUND_PROVIDERS: OutboundProvider[] = [
  {
    name: "GitHub",
    wire: async (item, artifacts) => {
      const built = buildTrackingIssue({ item, itemId: ID, projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts });
      const sc = new MemorySourceControl();
      await pushTrackingIssue(sc, 1, "acme/road", ID, built, null); // the real push path, capturing exactly what would be serialised
      return JSON.stringify([built, sc.sent]);
    },
  },
];

const fullItem = () => Object.fromEntries([...FIELDS.map((f) => f.key), "id", "tenant_id", "home_project_id", "created_by", "owner_user_id"].map((k) => [k, sentinel(k)]));

describe.each(OUTBOUND_PROVIDERS)("outbound $name payloads", ({ wire }) => {
  it("serialises to nothing but allowlisted fields, even when every field of the item is filled", async () => {
    const w = await wire(fullItem(), [{ label: "PRD", url: "https://example.test/prd" }]);
    for (const f of FIELDS) {
      if (allowed.has(f.key)) continue;
      expect(w, `${f.key} leaked into a payload`).not.toContain(sentinel(f.key));
    }
    for (const k of ["id", "tenant_id", "home_project_id", "created_by", "owner_user_id"]) expect(w, `${k} leaked`).not.toContain(sentinel(k));
    for (const k of allowed) if (!DERIVED.has(k)) expect(w).toContain(sentinel(k)); // and the allowed ones really are sent
  });

  it("MoSCoW and the rank only leave as pv: labels: a value and a band, never the rank number or any other field", async () => {
    const w = await wire({ ...fullItem(), moscow: "Should", stack_rank: 37 }, []);
    expect(w).toContain("pv:moscow/should");
    expect(w).toContain("pv:rank/top-50");
    expect(w).not.toMatch(/\b37\b/);
    for (const f of FIELDS) if (!allowed.has(f.key)) expect(w, `${f.key} leaked`).not.toContain(sentinel(f.key));
  });
});

describe("outbound GitHub payloads", () => {
  it("covers the whole field dictionary", () => {
    expect(FIELDS.length).toBeGreaterThanOrEqual(165);
    expect(FIELDS.some((f) => f.key === "value_12m")).toBe(true);
    for (const k of OUTBOUND_READ_FIELDS) expect(FIELDS.some((f) => f.key === k) || k === "item_code").toBe(true);
  });

  it("never reads a commercial field of the item in the first place", () => {
    const read: string[] = [];
    const item = new Proxy(fullItem(), { get: (t, k) => (read.push(String(k)), (t as Record<string, unknown>)[String(k)]) });
    buildTrackingIssue({ item, itemId: ID, projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [] });
    expect(read.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("the list of allowed fields has no commercial field in it", () => {
    const commercial = ["value", "value_12m", "value_basis", "value_type", "confidence", "customers_requesting", "target_customers", "decision", "decided_by", "decision_date", "cost_of_not_doing", "kr_metric", "kr_start", "kr_target", "kr_unit", "kr_direction", "value_proposition", "time_to_first_revenue_months", "target_markets", "live_markets", "outcomes"];
    for (const k of commercial) expect(allowed.has(k), k).toBe(false);
  });
});
