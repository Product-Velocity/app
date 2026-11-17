import { describe, expect, it } from "vitest";
import { MAX_EPIC_KEYS, parseEpicKeys } from "./epic-keys";

describe("parseEpicKeys", () => {
  it("takes keys separated by spaces, commas, semicolons or lines, upper-cased, without repeats", () => {
    expect(parseEpicKeys("r8p-5, DATA-9;\nR8P-5  qq-12")).toEqual({ keys: ["R8P-5", "DATA-9", "QQ-12"], invalid: [] });
  });
  it("takes the key out of a link to the issue", () => {
    expect(parseEpicKeys("https://acme.atlassian.net/browse/R8P-5?focusedId=1 https://acme.atlassian.net/browse/DATA-9").keys).toEqual(["R8P-5", "DATA-9"]);
  });
  it("reports what is not a key, cut short, and does not stop on it", () => {
    expect(parseEpicKeys("R8P-5 hello 12 R8P- ".padEnd(30) + "x".repeat(100))).toMatchObject({ keys: ["R8P-5"], invalid: expect.arrayContaining(["hello", "12", "R8P-"]) });
    expect(parseEpicKeys("x".repeat(100)).invalid[0]).toHaveLength(40);
  });
  it("is empty for nothing", () => {
    expect(parseEpicKeys("  \n ,; ")).toEqual({ keys: [], invalid: [] });
    expect(MAX_EPIC_KEYS).toBe(50);
  });
});
