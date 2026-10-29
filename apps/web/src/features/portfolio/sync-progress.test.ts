import { describe, expect, it } from "vitest";
import type { PlanItem, PushItemResult, ReceiveItem } from "@/lib/github/push-types";
import { applyBoardLines, boardCandidates, chunk, CHECK_CHUNK, dropWritten, failedCard, mergeChecked, unsentResult, replaceResults, writeAll, writingLabel, type WrittenOne } from "./sync-progress";

const card = (id: string, status: ReceiveItem["status"] = "in_step"): ReceiveItem => ({ id, code: id.toUpperCase(), name: id, status, received: [], issueNumber: 1, issueUrl: null });
const plan = (id: string): PlanItem => ({ id, action: "unchanged" }) as PlanItem;
const ids = Array.from({ length: 25 }, (_, i) => `i${String(i).padStart(2, "0")}`);

describe("checking 25 initiatives in chunks", () => {
  it("splits 25 ids into chunks of five, in order, and nothing is lost", () => {
    const parts = chunk(ids, CHECK_CHUNK);
    expect(parts).toHaveLength(5);
    expect(parts.every((p) => p.length === 5)).toBe(true);
    expect(parts.flat()).toEqual(ids);
    expect(chunk([], 5)).toEqual([]);
    expect(chunk(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
  it("cards arrive chunk by chunk and stay in the order of the selection", () => {
    let state = { received: [] as ReceiveItem[], send: [] as PlanItem[] };
    for (const part of [ids.slice(5, 10), ids.slice(0, 5)]) state = mergeChecked(ids, state, { received: part.map((i) => card(i)), send: part.map(plan) });
    expect(state.received.map((r) => r.id)).toEqual(ids.slice(0, 10));
    expect(state.send.map((p) => p.id)).toEqual(ids.slice(0, 10));
  });
  it("a retry replaces only that card and keeps its place", () => {
    const start = { received: ids.slice(0, 3).map((i, n) => (n === 1 ? failedCard(i) : card(i))), send: [] as PlanItem[] };
    const after = mergeChecked(ids, start, { received: [card(ids[1]!, "received")], send: [plan(ids[1]!)] });
    expect(after.received.map((r) => [r.id, r.status])).toEqual([[ids[0], "in_step"], [ids[1], "received"], [ids[2], "in_step"]]);
    expect(after.send.map((p) => p.id)).toEqual([ids[1]]);
  });
  it("a failed chunk gives its cards a message in words, not a dead end", () => {
    expect(failedCard("x")).toMatchObject({ id: "x", status: "error", message: expect.stringMatching(/try again/) });
  });
});

describe("board Status is added once, after the chunks", () => {
  it("adds the line to linked cards, turns in-step into received, and leaves unlinked and failed cards alone", () => {
    const received = [card("a"), card("b", "not_on_github"), card("c", "error"), card("d", "follows")];
    expect(boardCandidates(received)).toEqual(["a", "d"]);
    const out = applyBoardLines(received, { a: { label: "Delivery Status", from: "Ready", to: "Done" }, b: { label: "x", from: null, to: null } }, false);
    expect(out[0]).toMatchObject({ status: "received", received: [{ label: "Delivery Status", from: "Ready", to: "Done" }] });
    expect(out[1]).toEqual(received[1]);
    expect(out[2]).toEqual(received[2]);
    expect(out[3]).toEqual(received[3]);
  });
  it("an unreadable board is a note on the linked cards, and changes no status", () => {
    const out = applyBoardLines([card("a"), card("b", "missing")], {}, true);
    expect(out[0]).toMatchObject({ status: "in_step", message: expect.stringMatching(/board could not be read/) });
    expect(out[1]!.message).toBeUndefined();
  });
});

describe("writing progress", () => {
  const res = (id: string, outcome: PushItemResult["outcome"] = "updated"): PushItemResult => ({ id, code: id.toUpperCase(), outcome });
  it("counts what has been written out of what will be written", () => {
    expect(writingLabel(0, 25)).toBe("Writing 0/25");
    expect(writingLabel(7, 25)).toBe("Writing 7/25");
    expect(writingLabel(30, 25)).toBe("Writing 25/25");
  });
  it("results replace the earlier ones of the same initiative (a retry) and keep their place", () => {
    const first = [res("a"), res("b", "error"), res("c")];
    const after = replaceResults(first, "b", [res("b", "updated"), { ...res("b", "updated"), message: "Assignees updated." }]);
    expect(after.map((r) => [r.id, r.outcome])).toEqual([["a", "updated"], ["b", "updated"], ["b", "updated"], ["c", "updated"]]);
    expect(replaceResults(first, "d", [res("d")]).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("an initiative that was not reached is reported as not sent, in words", () => {
    expect(unsentResult("x", "R-1", "The connection was lost.")).toEqual({ id: "x", code: "R-1", outcome: "blocked", message: "The connection was lost." });
  });
  it("after a stop, the preview keeps only the initiatives that were not written", () => {
    const state = { received: ["a", "b", "c"].map((i) => card(i)), send: ["a", "b", "c"].map(plan) };
    const rest = dropWritten(state, new Set(["a", "c"]));
    expect(rest.received.map((r) => r.id)).toEqual(["b"]);
    expect(rest.send.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("writing the confirmed changes one by one", () => {
  const ok = (id: string): WrittenOne => ({ kind: "result", results: [{ id, code: id.toUpperCase(), outcome: "updated" }], taken: [] });
  const run = (todo: string[], by: Record<string, WrittenOne>, calls: [number, number][] = []) =>
    writeAll({ todo, codeOf: (id) => id.toUpperCase(), writeOne: async (id) => by[id] ?? ok(id), onProgress: (d, t) => calls.push([d, t]) });

  it("reports 0/y first, then x/y after each initiative, and keeps the order", async () => {
    const calls: [number, number][] = [];
    const r = await run(["a", "b", "c"], {}, calls);
    expect(calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    expect(r.results.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.stopped).toBeUndefined();
  });
  it("a failure is reported on its own and the others are still written", async () => {
    const r = await run(["a", "b", "c"], { b: { kind: "result", results: [{ id: "b", code: "B", outcome: "error", message: "GitHub refused." }], taken: [] } });
    expect(r.results.map((x) => [x.id, x.outcome])).toEqual([["a", "updated"], ["b", "error"], ["c", "updated"]]);
  });
  it("stops when GitHub changed for an initiative: it and the ones after it are not written", async () => {
    const written: string[] = [];
    const stale = { account: "acme", received: [card("b")], send: [plan("b")] };
    const r = await writeAll({ todo: ["a", "b", "c"], codeOf: (i) => i, onProgress: () => {}, writeOne: async (id) => { written.push(id); return id === "b" ? { kind: "stale", stale, error: "GitHub changed after you looked." } : ok(id); } });
    expect(written).toEqual(["a", "b"]);
    expect(r.results.map((x) => x.id)).toEqual(["a"]);
    expect(r.stopped).toMatchObject({ index: 1, id: "b", error: "GitHub changed after you looked." });
  });
  it("when the connection is lost the rest are reported as not sent, never as done", async () => {
    const r = await run(["a", "b", "c", "d"], { b: { kind: "lost", results: [{ id: "b", code: "B", outcome: "error", message: "lost" }] } });
    expect(r.results.map((x) => [x.id, x.outcome])).toEqual([["a", "updated"], ["b", "error"], ["c", "blocked"], ["d", "blocked"]]);
    expect(r.results[2]!.message).toMatch(/not sent/i);
  });
  it("collects the texts taken over from GitHub across initiatives", async () => {
    const take = (id: string): WrittenOne => ({ kind: "result", results: [], taken: [{ itemId: id, code: id, field: "summary", before: "x", after: "y" }] });
    const r = await run(["a", "b"], { a: take("a"), b: take("b") });
    expect(r.taken.map((t) => t.itemId)).toEqual(["a", "b"]);
  });
});
