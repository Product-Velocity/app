import { describe, expect, it } from "vitest";
import { MemorySourceControl, parseProjectItemEvent, planStatusApply, readBoardStatuses, type BoardItemStatus } from "./index";

const on = (repo: string, number: number, status: string | null, id = `PVTI_${number}`): BoardItemStatus => ({ itemId: id, issueNodeId: `I_${number}`, repo, number, status });
const link = (item_id: string, repo: string, number: number, over: Record<string, unknown> = {}) => ({ item_id, repo, number, projectItemId: null as string | null, current: null as string | null, ...over });

describe("planStatusApply: which initiatives get which Delivery Status", () => {
  it("matches board items to initiatives by repository and issue number (case-insensitive) and gives the board's own word", () => {
    const rows = planStatusApply([on("Acme/App", 175, "Ready"), on("acme/app", 176, "In progress")], [link("i1", "acme/app", 175), link("i2", "Acme/App", 176)]);
    expect(rows).toEqual([{ item_id: "i1", status: "Ready", board_item_id: "PVTI_175" }, { item_id: "i2", status: "In progress", board_item_id: "PVTI_176" }]);
  });
  it("skips what did not change, so a second pass writes nothing", () => {
    const l = link("i1", "Acme/App", 175, { current: "Ready", projectItemId: "PVTI_175" });
    expect(planStatusApply([on("Acme/App", 175, "Ready")], [l])).toEqual([]);
  });
  it("an item on the board with no status clears the status; a changed board item id is kept up to date", () => {
    expect(planStatusApply([on("Acme/App", 175, null)], [link("i1", "Acme/App", 175, { current: "Ready", projectItemId: "PVTI_175" })])).toEqual([{ item_id: "i1", status: null, board_item_id: "PVTI_175" }]);
    expect(planStatusApply([on("Acme/App", 175, "Ready", "PVTI_NEW")], [link("i1", "Acme/App", 175, { current: "Ready", projectItemId: "PVTI_OLD" })])).toEqual([{ item_id: "i1", status: "Ready", board_item_id: "PVTI_NEW" }]);
  });
  it("initiatives that are not on the board and board items that are not initiatives are left alone", () => {
    expect(planStatusApply([on("Acme/App", 999, "Ready")], [link("i1", "Acme/App", 175, { current: "Ready" })])).toEqual([]);
  });
  it("cuts a long status at 100 characters", () => {
    expect(planStatusApply([on("Acme/App", 1, "x".repeat(150))], [link("i1", "Acme/App", 1)])[0]!.status).toHaveLength(100);
  });
});

describe("readBoardStatuses", () => {
  it("reads the board's issues with their status through the source", async () => {
    const sc = new MemorySourceControl();
    sc.boardStatuses.set("PVT_1", [on("Acme/App", 175, "Ready")]);
    expect(await readBoardStatuses(sc, 1, "PVT_1", "Status")).toEqual([on("Acme/App", 175, "Ready")]);
  });
  it("a board that cannot be read gives nothing instead of failing the whole check", async () => {
    expect(await readBoardStatuses(new MemorySourceControl(), 1, "PVT_x", "Status")).toEqual([]);
  });
});

describe("parseProjectItemEvent", () => {
  const payload = (over: Record<string, unknown> = {}) => ({ action: "edited", installation: { id: 9 }, organization: { login: "Acme" }, projects_v2_item: { id: 1, node_id: "PVTI_1", project_node_id: "PVT_1", content_node_id: "I_1", content_type: "Issue" }, changes: { field_value: { field_name: "Status", field_type: "single_select" } }, ...over });
  it("reads the item, the board, the field that changed and the installation", () => {
    expect(parseProjectItemEvent("projects_v2_item", payload())).toEqual({ installationId: 9, action: "edited", itemNodeId: "PVTI_1", boardId: "PVT_1", fieldName: "Status" });
  });
  it("other events and malformed payloads are ignored", () => {
    expect(parseProjectItemEvent("issues", payload())).toBeNull();
    expect(parseProjectItemEvent("projects_v2_item", payload({ installation: {} }))).toBeNull();
    expect(parseProjectItemEvent("projects_v2_item", payload({ projects_v2_item: { node_id: 5 } }))).toBeNull();
    expect(parseProjectItemEvent("projects_v2_item", null)).toBeNull();
  });
  it("an event without a changed field still parses, with no field name", () => {
    expect(parseProjectItemEvent("projects_v2_item", payload({ action: "created", changes: undefined }))).toMatchObject({ action: "created", fieldName: null });
  });
});
