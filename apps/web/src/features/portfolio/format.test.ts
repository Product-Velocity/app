import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "@pv/domain";
import { formatField } from "./format";

const ctx = { today: new Date("2026-10-27T12:00:00Z"), members: [], projects: [] };

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
