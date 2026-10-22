import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "./dates";

// Wednesday 14 April 2027
const TODAY = new Date(Date.UTC(2027, 3, 14));
const ok = (input: string, edge: "start" | "end" = "start") => {
  const r = parseDate(input, TODAY, { edge });
  return r.ok ? r.iso : `ERR:${r.error}`;
};

describe("parseDate", () => {
  it("accepts ISO dates", () => {
    expect(ok("2027-03-31")).toBe("2027-03-31");
    expect(ok(" 2027-3-5 ")).toBe("2027-03-05");
  });

  it("accepts day-month in words, with or without year, either order", () => {
    expect(ok("31 mar")).toBe("2027-03-31");
    expect(ok("31 March 2028")).toBe("2028-03-31");
    expect(ok("mar 31")).toBe("2027-03-31");
    expect(ok("March 31, 2028")).toBe("2028-03-31");
    expect(ok("1st sept")).toBe("2027-09-01");
    expect(ok("22nd of Feb")).toBe("2027-02-22");
  });

  it("reads numeric dates as day/month (European)", () => {
    expect(ok("31/3")).toBe("2027-03-31");
    expect(ok("3/4/2027")).toBe("2027-04-03");
    expect(ok("31.03.2027")).toBe("2027-03-31");
    expect(ok("31-3-27")).toBe("2027-03-31");
  });

  it("accepts relative words", () => {
    expect(ok("today")).toBe("2027-04-14");
    expect(ok("tomorrow")).toBe("2027-04-15");
    expect(ok("yesterday")).toBe("2027-04-13");
    expect(ok("in 3 days")).toBe("2027-04-17");
    expect(ok("in 2 weeks")).toBe("2027-04-28");
    expect(ok("in 1 month")).toBe("2027-05-14");
    expect(ok("next week")).toBe("2027-04-19"); // Monday
    expect(ok("next month")).toBe("2027-05-01");
  });

  it("accepts weekdays: the next one strictly after today", () => {
    expect(ok("friday")).toBe("2027-04-16");
    expect(ok("next friday")).toBe("2027-04-16");
    expect(ok("wednesday")).toBe("2027-04-21"); // today is Wednesday, so next week's
    expect(ok("mon")).toBe("2027-04-19");
  });

  it("accepts quarters and month names, using the start or end depending on the column", () => {
    expect(ok("q2", "start")).toBe("2027-04-01");
    expect(ok("q2", "end")).toBe("2027-06-30");
    expect(ok("Q4 2027", "end")).toBe("2027-12-31");
    expect(ok("2028 q1", "start")).toBe("2028-01-01");
    expect(ok("end of q3")).toBe("2027-09-30");
    expect(ok("march", "start")).toBe("2027-03-01");
    expect(ok("march", "end")).toBe("2027-03-31");
    expect(ok("feb 2028", "end")).toBe("2028-02-29"); // leap year
    expect(ok("end of month")).toBe("2027-04-30");
    expect(ok("end of year")).toBe("2027-12-31");
    expect(ok("eoy")).toBe("2027-12-31");
  });

  it("clears on empty input", () => {
    expect(parseDate("", TODAY)).toEqual({ ok: true, iso: null });
    expect(parseDate("   ", TODAY)).toEqual({ ok: true, iso: null });
  });

  it.each(["31 feb", "32/1", "13/13/2027", "banana", "q5", "in 0 days x", "2027-02-30", "99999-01-01", "mar 32"])(
    "rejects %j with a message",
    (bad) => {
      const r = parseDate(bad, TODAY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    },
  );
});

describe("formatDate", () => {
  it("shows day, month and the year only when it is not the current year", () => {
    expect(formatDate("2027-03-31", TODAY)).toBe("31 Mar");
    expect(formatDate("2028-01-05", TODAY)).toBe("5 Jan 2028");
    expect(formatDate(null, TODAY)).toBe("");
  });
  it("round-trips: what is displayed can be typed back", () => {
    for (const iso of ["2027-03-31", "2028-01-05", "2026-12-24"]) {
      const shown = formatDate(iso, TODAY);
      expect(ok(shown)).toBe(iso);
    }
  });
});
