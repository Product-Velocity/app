import { describe, expect, it } from "vitest";
import type { AccountRow } from "./accounts-model";
import { NO_FILTERS, fieldChoices, filterAccounts, filterCount, groupAccountRows, groupSummary, isHeader } from "./accounts-view";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const row = (o: Partial<AccountRow>): AccountRow => ({
  tenant_id: o.name ?? "t", name: "Acme", plan: "Trial", owner_email: "o@x.test", owner_name: null, member_count: 1, requested_count: 0, invited_count: 0, project_count: 1, item_count: 3,
  last_activity: "2026-11-20T00:00:00Z", last_login_at: null, access_override: null, created_at: "2026-10-01T00:00:00Z", company_url: null, country: null, claude_enabled: false,
  ai_agents: [], github_state: null, jira_state: null, suspended_at: null, ...o,
});
const A = row({ name: "Alpha", plan: "Team", country: "Norway", company_url: "https://alpha.test", github_state: "connected", ai_agents: [{ name: "Claude Desktop", connections: 1, last_used_at: null, calls: 1 }] });
const B = row({ name: "Beta", suspended_at: "2026-11-21T00:00:00Z", country: "Norway", last_activity: null });
const C = row({ name: "Gamma", owner_email: "ines@gamma.test", access_override: "read_only" });
const ALL = [A, B, C];

describe("search, quick filters and rules", () => {
  it("search looks in name, URL, owner, plan, country and AI agent names", () => {
    const find = (q: string) => filterAccounts(ALL, { ...NO_FILTERS, search: q }, NOW).map((r) => r.name);
    expect(find("alpha.test")).toEqual(["Alpha"]);
    expect(find("ines@")).toEqual(["Gamma"]);
    expect(find("claude desktop")).toEqual(["Alpha"]);
    expect(find("paused")).toEqual(["Beta"]);
    expect(find("norway")).toEqual(["Alpha", "Beta"]);
  });
  it("quick filters combine with AND", () => {
    expect(filterAccounts(ALL, { ...NO_FILTERS, quick: ["active", "agents"] }, NOW).map((r) => r.name)).toEqual(["Alpha"]);
    expect(filterAccounts(ALL, { ...NO_FILTERS, quick: ["paused", "agents"] }, NOW)).toEqual([]);
  });
  it("a rule matches any of its values; a rule without values is ignored; rules combine with AND", () => {
    expect(filterAccounts(ALL, { ...NO_FILTERS, rules: [{ field: "country", values: ["Norway", "Not set"] }] }, NOW)).toHaveLength(3);
    expect(filterAccounts(ALL, { ...NO_FILTERS, rules: [{ field: "country", values: [] }] }, NOW)).toHaveLength(3);
    expect(filterAccounts(ALL, { ...NO_FILTERS, rules: [{ field: "country", values: ["Norway"] }, { field: "status", values: ["Active"] }] }, NOW).map((r) => r.name)).toEqual(["Alpha"]);
    expect(filterAccounts(ALL, { ...NO_FILTERS, rules: [{ field: "access", values: ["Read-only"] }] }, NOW).map((r) => r.name)).toEqual(["Gamma"]);
  });
  it("counts what is filtered and offers the values that exist", () => {
    expect(filterCount({ search: "x", quick: ["paused"], rules: [{ field: "plan", values: ["Team"] }, { field: "plan", values: [] }] })).toBe(2);
    expect(fieldChoices(ALL, "agent").map((c) => c.value)).toEqual(["Claude Desktop", "None"]);
    expect(fieldChoices(ALL, "github").map((c) => c.value)).toEqual(["Connected", "Not connected"]);
  });
});

describe("group by", () => {
  it("draws a header before each group with its count in words, and hides collapsed groups", () => {
    const rows = groupAccountRows(ALL, "country", null, new Set());
    expect(rows.filter(isHeader).map((h) => `${h.label}:${h.count}:${h.unit}`)).toEqual(["Norway:2:accounts", "Not set:1:account"]);
    expect(rows).toHaveLength(5);
    const folded = groupAccountRows(ALL, "country", null, new Set(["country:Norway"]));
    expect(folded).toHaveLength(3);
  });
  it("'Then by' nests a second header level inside the first", () => {
    const rows = groupAccountRows(ALL, "country", "status", new Set());
    expect(rows.filter(isHeader).map((h) => `${h.level}:${h.label}`)).toEqual(["0:Norway", "1:Active", "1:Paused", "0:Not set", "1:Active"]);
  });
  it("without a grouping the rows come back as they are, and the summary says None", () => {
    expect(groupAccountRows(ALL, null, null, new Set())).toEqual(ALL);
    expect(groupSummary(null, null)).toBe("None");
    expect(groupSummary("country", "status")).toBe("Country › Status");
  });
});
