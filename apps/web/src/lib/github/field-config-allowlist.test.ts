import { describe, expect, it } from "vitest";
import { buildTrackingIssue, MemorySourceControl, OUTBOUND_READ_FIELDS, pushTrackingIssue } from "@pv/github";
import { FIELDS } from "@pv/domain";

// CLAUDE.md rule 2 with a field configuration (decision 2026-11-03-tracker-field-config): same sentinel method as outbound-allowlist.test.ts.
const ID = "22222222-2222-4222-8222-222222222222";
const allowed = new Set<string>(OUTBOUND_READ_FIELDS);
const sentinel = (key: string) => `LEAK_${key.toUpperCase()}_9f3a`;
const fullItem = () => Object.fromEntries([...FIELDS.map((f) => f.key), "id", "tenant_id", "home_project_id", "created_by", "owner_user_id"].map((k) => [k, sentinel(k)]));

describe("a custom field configuration can not make a non-allowlisted field appear (decision 2026-11-03-tracker-field-config)", () => {
  const OFFS: (readonly string[])[] = [
    [],
    ["github.label.moscow", "github.label.rank", "github.label.type", "github.label.group", "github.label.project", "github.milestone", "github.issueType", "github.body.artifacts", "github.body.files"],
    ["value_12m", "confidence", "decision", "github.title"], // slot names of commercial fields, and a fixed slot: no effect
  ];
  it.each(OFFS.map((o, n) => [n, o] as const))("off list %i: nothing but allowlisted fields is serialised", async (_n, off) => {
    const built = buildTrackingIssue({ item: fullItem(), itemId: ID, projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [{ label: "PRD", url: "https://example.test/prd" }], off });
    const sc = new MemorySourceControl();
    await pushTrackingIssue(sc, 1, "acme/road", ID, built, null);
    const w = JSON.stringify([built, sc.sent]);
    for (const f of FIELDS) if (!allowed.has(f.key)) expect(w, `${f.key} leaked into a payload`).not.toContain(sentinel(f.key));
  });
});
