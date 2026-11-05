import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSlots } from "./mapping";

// The closed list of changeable slots lives twice: in slots.ts (the app) and in tracker_set_field_config (the database, which checks it again).
// This test fails when one is changed without the other.
// the latest definition wins: the migrations are read in order and the last list is the one the database has
const dir = join(__dirname, "../../../../../packages/db/migrations");
const sql = readdirSync(dir).filter((f) => /tracker_field_config|jira_description_sections|optional_field_labels|value_quarter_labels_focus_field/.test(f)).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const listIn = (tracker: "jira" | "github") => {
  const all = [...sql.matchAll(tracker === "jira" ? /when 'jira' then array\[([^\]]*)\]/g : /else array\[([^\]]*)\]/g)];
  return [...(all[all.length - 1]?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
};
const defaultOff = (tracker: "jira" | "github") => [...([...sql.matchAll(/v_default_off constant text\[\] := array\[([^\]]*)\]/g)].at(-1)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]!).filter((s) => s.startsWith(`${tracker}.`)).sort();
describe("the switches that are off by default match the app", () => {
  it.each(["jira", "github"] as const)("%s", (t) => {
    expect(defaultOff(t)).toEqual(configSlots(t).filter((s) => s.defaultOn === false).map((s) => s.id).sort());
  });
});
describe("the slot list of the database matches the app", () => {
  it.each(["jira", "github"] as const)("%s", (t) => {
    expect(listIn(t)).toEqual(configSlots(t).map((s) => s.id).sort());
  });
});
