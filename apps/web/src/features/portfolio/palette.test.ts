import { describe, expect, it } from "vitest";
import { rankCommands } from "./palette";

const c = (label: string, group = "Actions", keywords = "") => ({ id: label, label, group, keywords, run: () => {} });
const list = [c("Add initiative", "Actions", "new create"), c("Go to view: Planning", "Views"), c("Go to view: Prioritisation", "Views"), c("Group by MoSCoW", "Grouping"), c("Clear filters", "Filters"), c("Export all rows", "Actions", "csv download")];

describe("rankCommands", () => {
  it("shows the first commands when nothing is typed", () => {
    expect(rankCommands(list, "", 3).map((x) => x.label)).toEqual(["Add initiative", "Go to view: Planning", "Go to view: Prioritisation"]);
  });
  it("needs every word, in the label, the keywords or the group", () => {
    expect(rankCommands(list, "plan").map((x) => x.label)).toEqual(["Go to view: Planning"]);
    expect(rankCommands(list, "csv").map((x) => x.label)).toEqual(["Export all rows"]);
    expect(rankCommands(list, "views plan").map((x) => x.label)).toEqual(["Go to view: Planning"]);
    expect(rankCommands(list, "zzz")).toEqual([]);
  });
  it("ranks a match at the start of a word above one inside a word", () => {
    expect(rankCommands(list, "group").map((x) => x.label)[0]).toBe("Group by MoSCoW");
  });
  it("is not case sensitive and respects the limit", () => {
    expect(rankCommands(list, "ADD")[0]!.label).toBe("Add initiative");
    expect(rankCommands(list, "o", 2)).toHaveLength(2);
  });
});
