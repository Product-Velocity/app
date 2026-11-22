import { describe, expect, it } from "vitest";
import { agentsText, chipCounts, chipMatches, companyHost, csvSafe, memberErrorText, memberMoves, safeUrl, totals, trackerText, type AccountRow } from "./accounts-model";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const row = (o: Partial<AccountRow> = {}): AccountRow => ({
  tenant_id: "t", name: "Acme", plan: "Trial", owner_email: null, owner_name: null, member_count: 1, requested_count: 0, invited_count: 0, project_count: 1, item_count: 3,
  last_activity: "2026-11-20T00:00:00Z", last_login_at: null, access_override: null, created_at: "2026-10-01T00:00:00Z", company_url: null, country: null, claude_enabled: false,
  ai_agents: [], github_state: null, jira_state: null, suspended_at: null, ...o,
});

describe("view chips", () => {
  const rows = [
    row(),
    row({ suspended_at: "2026-11-21T00:00:00Z", last_activity: null }),
    row({ ai_agents: [{ name: "Claude Desktop", connections: 2, last_used_at: null, calls: 5 }], requested_count: 2 }),
    row({ last_activity: "2026-09-01T00:00:00Z" }),
  ];
  it("counts every chip over the same rows", () => {
    expect(chipCounts(rows, NOW)).toEqual({ all: 4, active: 3, paused: 1, agents: 1, requests: 1, quiet: 2 });
  });
  it("'No activity in 30 days' includes an account that never had any", () => {
    expect(chipMatches(rows[1]!, "quiet", NOW)).toBe(true);
    expect(chipMatches(rows[0]!, "quiet", NOW)).toBe(false);
  });
});

describe("what the grid shows", () => {
  it("totals add members and line items over the rows given", () => {
    expect(totals([row({ member_count: 4, item_count: 10 }), row({ member_count: 2, item_count: 5, suspended_at: "x", ai_agents: [{ name: "C", connections: 1, last_used_at: null, calls: 0 }] })]))
      .toEqual({ accounts: 2, paused: 1, members: 6, items: 15, withAgents: 1 });
  });
  it("names the agents, with a count when one is connected more than once, and says when Claude is on but unused", () => {
    expect(agentsText(row({ ai_agents: [{ name: "Claude Desktop", connections: 3, last_used_at: null, calls: 0 }, { name: "Cursor", connections: 1, last_used_at: null, calls: 0 }] }))).toBe("Claude Desktop ×3, Cursor");
    expect(agentsText(row({ claude_enabled: true }))).toBe("Claude on, none connected");
    expect(agentsText(row())).toBe("None");
  });
  it("uses words for tracker states", () => {
    expect(trackerText(null)).toBe("Not connected");
    expect(trackerText("reconnect_needed")).toBe("Reconnect needed");
    expect(trackerText("connected")).toBe("Connected");
  });
  it("shows the host of the company URL and links only web addresses", () => {
    expect(companyHost("https://www.meridian.test/about")).toBe("meridian.test");
    expect(companyHost("nonsense")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://a.test")).toBe("https://a.test");
  });
  it("defuses spreadsheet formulas in the CSV export", () => {
    expect(csvSafe("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(csvSafe("-1+1")).toBe("'-1+1");
    expect(csvSafe("Acme")).toBe("Acme");
    expect(csvSafe(null)).toBe("");
  });
});

describe("people actions", () => {
  it("offers the same status moves as the Members grid, none for invitations or service accounts", () => {
    const m = (status: "requested" | "active" | "paused" | "revoked") => memberMoves({ kind: "member", status, is_service_account: false }).map((x) => x.status);
    expect(m("requested")).toEqual(["active", "revoked"]);
    expect(m("active")).toEqual(["paused", "revoked"]);
    expect(m("paused")).toEqual(["active", "revoked"]);
    expect(m("revoked")).toEqual(["active"]);
    expect(memberMoves({ kind: "invitation", status: "invited", is_service_account: false })).toEqual([]);
    expect(memberMoves({ kind: "member", status: "active", is_service_account: true })).toEqual([]);
  });
  it("explains each refusal in plain words", () => {
    expect(memberErrorText("PV020")).toMatch(/Sign in again/);
    expect(memberErrorText("PV021")).toMatch(/read-only/);
    expect(memberErrorText("PV003")).toMatch(/at least one active admin/);
    expect(memberErrorText(undefined)).toMatch(/did not work/);
  });
});
