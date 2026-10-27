import { describe, expect, it } from "vitest";
import type { PlanItem, ReceiveItem } from "@/lib/github/push-types";
import { applyBoardLines, boardCandidates, chunk, CHECK_CHUNK, failedCard, mergeChecked } from "./sync-progress";

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
