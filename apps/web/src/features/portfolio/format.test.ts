import { afterEach, describe, expect, it } from "vitest";
import { FIELD_BY_KEY, setDateFormat } from "@pv/domain";
import { formatField, trackerDay } from "./format";

const ctx = { today: new Date("2026-10-27T12:00:00Z"), people: [], projects: [] };

describe("Last Synced is shown as a day and a time", () => {
  it("formats the time, not only the day, and leaves other calculated dates as days", () => {
    expect(formatField(FIELD_BY_KEY.last_synced!, "2026-10-27T10:15:00Z", ctx)).toMatch(/^27 Oct,? \d\d:\d\d$/);
    expect(formatField(FIELD_BY_KEY.gh_last_activity!, "2026-10-27T10:15:00Z", ctx)).toBe("27 Oct 2026");
  });
  it("is empty when there is no value", () => {
    expect(formatField(FIELD_BY_KEY.last_synced!, null, ctx)).toBe("");
    expect(formatField(FIELD_BY_KEY.synced_with!, "GitHub · Acme/App", ctx)).toBe("GitHub · Acme/App");
  });
});

describe("trackerDay (dates from Jira and GitHub follow the person's format, not the browser's)", () => {
  afterEach(() => setDateFormat("d MMM yyyy"));
  const iso = "2026-11-17T08:18:03.663Z";
  const mid = new Date(2026, 10, 17, 12); // local noon: the same calendar day in every timezone
  it("uses the chosen format", () => {
    setDateFormat("dd/mm/yyyy");
    expect(trackerDay(mid.toISOString())).toBe("17/11/2026");
    setDateFormat("mm/dd/yyyy");
    expect(trackerDay(mid.toISOString())).toBe("11/17/2026");
    setDateFormat("yyyy-mm-dd");
    expect(trackerDay(mid.toISOString())).toBe("2026-11-17");
    expect(trackerDay(iso, new Date(2026, 0, 1))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("is empty for nothing or a date it cannot read", () => {
    expect(trackerDay(null)).toBe("");
    expect(trackerDay("not a date")).toBe("");
  });
});
