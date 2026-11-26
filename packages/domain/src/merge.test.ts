import { describe, expect, it } from "vitest";
import { applyMerge, blockKey, mergeTexts, splitBlocks, MAX_MERGE_BLOCKS, type MergeChunk } from "./merge";

const BASE = "# Plan\n\nIntro paragraph.\n\n## Scope\n\nBuild the thing.\n\n## Risks\n\nNone known.\n";
const merge = (b: string, o: string, t: string): MergeChunk[] => { const r = mergeTexts(b, o, t); if (!r.ok) throw new Error(r.error); return r.chunks; };
const text = (b: string, o: string, t: string, choices: Record<number, "ours" | "theirs" | "both"> = {}): string => { const m = applyMerge(merge(b, o, t), choices); if (!m.ok) throw new Error(m.error); return m.markdown; };

describe("blocks", () => {
  it("splits on blank lines and never cuts a fenced code block or a table", () => {
    expect(splitBlocks("# A\n\ntext\nmore\n\n```\ncode\n\nstill code\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n")).toEqual(["# A", "text\nmore", "```\ncode\n\nstill code\n```", "| a | b |\n| - | - |\n| 1 | 2 |"]);
  });
  it("compares by how the text reads, not how Markdown is written", () => {
    expect(blockKey("Some *emphasis*  here")).toBe(blockKey("Some _emphasis_ here"));
    expect(blockKey("- one\n- two")).toBe(blockKey("* one\n* two"));
    expect(blockKey("one")).not.toBe(blockKey("two"));
  });
});

describe("a three-way merge by block", () => {
  it("nothing changed: one block of text, no conflict", () => {
    const r = mergeTexts(BASE, BASE, BASE);
    expect(r).toMatchObject({ ok: true, conflicts: 0 });
    expect(text(BASE, BASE, BASE)).toBe(BASE);
  });
  it("changes in different blocks both come through, with no choice to make", () => {
    const ours = BASE.replace("Build the thing.", "Build the thing, in two steps.");
    const theirs = BASE.replace("None known.", "Vendor delay possible.");
    const r = mergeTexts(BASE, ours, theirs);
    expect(r).toMatchObject({ ok: true, conflicts: 0 });
    expect(text(BASE, ours, theirs)).toBe("# Plan\n\nIntro paragraph.\n\n## Scope\n\nBuild the thing, in two steps.\n\n## Risks\n\nVendor delay possible.\n");
  });
  it("a block added by one side and a block removed by the other both come through", () => {
    const ours = BASE.replace("Intro paragraph.\n", "Intro paragraph.\n\nA new note after the intro.\n");
    const theirs = BASE.replace("## Risks\n\nNone known.\n", "");
    expect(text(BASE, ours, theirs)).toBe("# Plan\n\nIntro paragraph.\n\nA new note after the intro.\n\n## Scope\n\nBuild the thing.\n");
  });
  it("an addition right next to a block the other side deleted is a conflict (the edits touch), never guessed", () => {
    const ours = BASE + "\nA new closing note.\n";
    const theirs = BASE.replace("## Risks\n\nNone known.\n", "");
    expect(mergeTexts(BASE, ours, theirs)).toMatchObject({ ok: true, conflicts: 1 });
  });
  it("the same change on both sides is taken once", () => {
    const both = BASE.replace("None known.", "Two known.");
    const r = mergeTexts(BASE, both, both);
    expect(r).toMatchObject({ ok: true, conflicts: 0 });
    expect(text(BASE, both, both)).toBe(both);
  });
  it("a block both sides changed differently is a conflict the person settles; nothing is guessed", () => {
    const ours = BASE.replace("Build the thing.", "Build the thing in Q1.");
    const theirs = BASE.replace("Build the thing.", "Build the thing with Acme.");
    const r = mergeTexts(BASE, ours, theirs);
    expect(r).toMatchObject({ ok: true, conflicts: 1 });
    const idx = (r.ok ? r.chunks : []).findIndex((c) => c.kind === "conflict");
    expect(applyMerge(r.ok ? r.chunks : [], {})).toEqual({ ok: false, error: expect.stringContaining("Choose a side") });
    expect(text(BASE, ours, theirs, { [idx]: "ours" })).toContain("Build the thing in Q1.");
    expect(text(BASE, ours, theirs, { [idx]: "ours" })).not.toContain("Acme");
    expect(text(BASE, ours, theirs, { [idx]: "theirs" })).toContain("with Acme.");
    const both = text(BASE, ours, theirs, { [idx]: "both" });
    expect(both).toContain("Build the thing in Q1.\n\nBuild the thing with Acme.");
    expect(both).toContain("## Risks");
  });
  it("a block one side deleted and the other changed is a conflict", () => {
    const ours = BASE.replace("## Risks\n\nNone known.\n", "");
    const theirs = BASE.replace("None known.", "Vendor delay possible.");
    const r = mergeTexts(BASE, ours, theirs);
    expect(r).toMatchObject({ ok: true, conflicts: 1 });
  });
  it("a difference only in how Markdown is written is not a change, and the text taken is the side's own", () => {
    const ours = BASE.replace("Intro paragraph.", "Intro *paragraph*.");
    const theirs = BASE.replace("Intro paragraph.", "Intro _paragraph_.").replace("None known.", "Vendor delay possible.");
    const r = mergeTexts(BASE, ours, theirs);
    expect(r).toMatchObject({ ok: true, conflicts: 0 });
    const out = text(BASE, ours, theirs);
    expect(out).toContain("Vendor delay possible.");
    expect(out).toContain("Intro *paragraph*.");
  });
  it("refuses a text with too many blocks, in words", () => {
    const big = Array.from({ length: MAX_MERGE_BLOCKS + 1 }, (_, i) => `Block ${i}`).join("\n\n");
    expect(mergeTexts(big, big, big)).toEqual({ ok: false, error: expect.stringContaining("too long to merge") });
  });
  it("is deterministic", () => {
    const ours = BASE.replace("Build the thing.", "Build it.");
    const theirs = BASE.replace("Build the thing.", "Make it.");
    expect(JSON.stringify(mergeTexts(BASE, ours, theirs))).toBe(JSON.stringify(mergeTexts(BASE, ours, theirs)));
  });
});
