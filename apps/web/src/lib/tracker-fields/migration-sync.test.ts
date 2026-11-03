import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSlots } from "./mapping";

// The closed list of changeable slots lives twice: in slots.ts (the app) and in tracker_set_field_config (the database, which checks it again).
// This test fails when one is changed without the other.
const sql = readFileSync(join(__dirname, "../../../../../packages/db/migrations/20261103233355_tracker_field_config.sql"), "utf8");
const listIn = (tracker: "jira" | "github") => {
  const m = new RegExp(`when '${tracker}' then array\\[([^\\]]*)\\]|else array\\[([^\\]]*)\\]`, "g");
  const all = [...sql.matchAll(m)].map((x) => x[1] ?? x[2] ?? "");
  const text = tracker === "jira" ? all[0]! : all[1]!;
  return [...text.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
};
describe("the slot list of the database matches the app", () => {
  it.each(["jira", "github"] as const)("%s", (t) => {
    expect(listIn(t)).toEqual(configSlots(t).map((s) => s.id).sort());
  });
});
