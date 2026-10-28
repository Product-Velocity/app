import { describe, expect, it } from "vitest";
import { actionLabel, auditCsv, csvCell, formatWhen, nextDay, parseAuditFilters, roleAtTime, whoLabel, type AuditRow } from "./audit-log";

const row = (o: Partial<AuditRow> = {}): AuditRow => ({
  id: 1, tenant_id: "t1", entity: "items", entity_id: "i1", field: "initiative_name", old: "A", new: "B", actor_id: "u1", actor_name: "Pat Owner",
  actor_email: "pat@platform.test", actor_role: "platform_admin", actor_platform_admin: true, project_id: "p1", screen: "gantt", batch_id: null, via: "UI",
  at: "2026-10-28T12:00:00Z", ...o,
});

describe("audit entry wording (FR-6.2)", () => {
  it("names the person with name and email, and the role at the time", () => {
    expect(whoLabel(row())).toBe("Pat Owner (pat@platform.test)");
    expect(roleAtTime("admin")).toBe("Account Admin");
    expect(roleAtTime("platform_admin")).toBe("Platform admin");
    expect(roleAtTime(null)).toBe("—");
  });
  it("says so for system entries and for entries from before names were recorded", () => {
    expect(whoLabel(row({ actor_id: null, actor_name: null, actor_email: null, via: "system" }))).toBe("System (automatic)");
    expect(whoLabel(row({ actor_id: null, actor_name: null, actor_email: null, via: "GitHub webhook" }))).toBe("GitHub (automatic)");
    expect(whoLabel(row({ actor_name: null, actor_email: null }))).toMatch(/before names were recorded/);
  });
  it("describes entering and leaving as events", () => {
    expect(actionLabel({ entity: "platform_access", field: "entered", old: null, new: {} })).toBe("Entered the account");
    expect(actionLabel({ entity: "platform_access", field: "left", old: null, new: null })).toBe("Left the account");
    expect(actionLabel({ entity: "items", field: "initiative_name", old: "a", new: "b" })).toBe("Initiative · initiative name");
  });
});

describe("filters from the address bar", () => {
  it("keeps clean values only", () => {
    expect(parseAuditFilters({ actor: " pat ", from: "2026-10-01", to: "nope", project: "x", before: "12" })).toEqual({ actor: "pat", action: undefined, project: undefined, from: "2026-10-01", to: undefined, before: "12" });
    expect(parseAuditFilters({ project: "0b6f2a1c-3d4e-4f50-8a9b-1c2d3e4f5a6b" }).project).toBeDefined();
    expect(parseAuditFilters({ before: "1; drop table" }).before).toBeUndefined();
  });
  it("makes the end date inclusive", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("CSV export (FR-6.6)", () => {
  it("quotes, and defuses formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
  it("has one line per entry with who, role, where, what and how", () => {
    const csv = auditCsv([row(), row({ id: 2, actor_id: null, actor_name: null, actor_email: null, actor_role: null, actor_platform_admin: false, via: "system", old: null, new: "x" })], {
      accounts: { t1: "Meridian" }, projects: { p1: "Platform" }, objects: { i1: "R-12 Login" },
    }).trim().split("\r\n");
    expect(csv).toHaveLength(3);
    expect(csv[0]).toContain("Role at the time");
    expect(csv[1]).toBe("2026-10-28T12:00:00Z,Pat Owner,pat@platform.test,Platform admin,yes,Meridian,Platform,R-12 Login,gantt,Initiative · initiative name,initiative_name,A,B,UI,,1");
    expect(csv[2]).toContain("System");
  });
});

describe("timestamps with a time zone (FR-6.2)", () => {
  it("shows the zone, in the account's time zone when it has one", () => {
    expect(formatWhen("2026-10-28T14:03:22Z")).toBe("28 Oct 2026, 14:03:22 UTC");
    expect(formatWhen("2026-10-28T14:03:22Z", "Europe/Madrid")).toMatch(/^28 Oct 2026, 15:03:22 (GMT\+1|CET)$/);
    expect(formatWhen("2026-10-28T14:03:22Z", "Not/AZone")).toBe("28 Oct 2026, 14:03:22 UTC");
    expect(formatWhen("2026-10-28T14:03:22Z", "UTC", false)).toBe("28 Oct 2026, 14:03 UTC");
    expect(formatWhen(null)).toBe("—");
    expect(formatWhen("garbage")).toBe("garbage");
  });
});
