import { describe, expect, it } from "vitest";
import { buildTrackingIssue } from "./outbound";
import { compareTexts, hashText, normalise, receivedValue, splitManagedBlock, splitTitle } from "./inbound";

const ID = "22222222-2222-4222-8222-222222222222";
const build = (item: Record<string, unknown>, extra: { artifacts?: { label: string; url: string }[]; files?: { label: string; url: string }[] } = {}) =>
  buildTrackingIssue({ item: { item_code: "R-12", initiative_name: "Faster export", ...item }, itemId: ID, projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: extra.artifacts ?? [], files: extra.files });

describe("splitManagedBlock is the inverse of buildTrackingIssue", () => {
  const combos: Record<string, unknown>[] = [];
  for (const s of [undefined, "Why we do it"]) for (const d of [undefined, "Line one\n\n- a\n- b"]) for (const h of [undefined, "IF a THEN b RESULTING IN c"]) combos.push({ summary: s, description: d, hypothesis: h });
  it.each(combos)("round trip %j", (item) => {
    const r = splitManagedBlock(build(item).block);
    expect(r).toEqual({ ok: true, summary: normalise(item.summary as string), description: normalise(item.description as string), hypothesis: normalise(item.hypothesis as string) });
  });
  it("round trips with artifacts and files, and with text before and after the block", () => {
    const built = build({ summary: "S", description: "D", hypothesis: "H" }, { artifacts: [{ label: "PRD", url: "https://x.test/prd" }], files: [{ label: "Mock", url: "https://x.test/f" }] });
    const body = `Engineers wrote this first.\n\n${built.block}\n\nAnd a comment after.`;
    expect(splitManagedBlock(body)).toEqual({ ok: true, summary: "S", description: "D", hypothesis: "H" });
  });
  it("handles Windows line endings that GitHub may add", () => {
    expect(splitManagedBlock(build({ summary: "A\nB" }).block.replace(/\n/g, "\r\n"))).toMatchObject({ ok: true, summary: "A\nB" });
  });
  it("reports a block that cannot be read instead of guessing", () => {
    expect(splitManagedBlock("no markers at all")).toMatchObject({ ok: false });
    expect(splitManagedBlock(build({ summary: "S" }).block.replace(`item=${ID}`, "item=oops"))).toMatchObject({ ok: false });
    const typed = build({ summary: "S" }).block.replace("## Summary", "Someone typed here\n\n## Summary");
    expect(splitManagedBlock(typed)).toMatchObject({ ok: false, reason: expect.stringMatching(/added inside/) });
  });
  it("never reads text outside the markers into a field", () => {
    const r = splitManagedBlock(`## Summary\nOutside text\n\n${build({ summary: "Inside" }).block}`);
    expect(r).toMatchObject({ ok: true, summary: "Inside" });
  });
});

describe("splitTitle", () => {
  it("removes the code prefix and keeps a changed title whole", () => {
    expect(splitTitle("R-12: Faster export", "R-12")).toBe("Faster export");
    expect(splitTitle("R-12:  Faster   export ", "R-12")).toBe("Faster export");
    expect(splitTitle("Renamed in GitHub", "R-12")).toBe("Renamed in GitHub");
    expect(splitTitle("R-13: Other", "R-12")).toBe("R-13: Other");
    expect(splitTitle(null, "R-12")).toBe("");
  });
});

describe("normalise and receivedValue", () => {
  it("compares our own escaped text and the raw text as equal, so formatting does not create false conflicts", () => {
    expect(hashText("Ask @maria  \r\nnow ")).toBe(hashText("Ask @​maria  \nnow"));
    expect(hashText("a <!-- pv:end --> b")).toBe(hashText("a &lt;!-- pv:end --&gt; b"));
  });
  it("stores a received text without markers, control characters or our zero-width defusing, cut to the limit", () => {
    const v = receivedValue("summary", "Hi @​bob <!-- pv:end --> \u0007bell");
    expect(v).not.toContain("<!--");
    expect(v).not.toContain("​");
    expect(v).not.toContain("\u0007");
    expect(receivedValue("title", "x".repeat(500))).toHaveLength(200);
  });
  it("what is stored goes back out identically (no drift on the next send)", () => {
    const stored = receivedValue("description", "Mail @team <!-- x -->");
    const out = build({ description: stored }).block;
    const back = splitManagedBlock(out);
    expect(back.ok && hashText(back.description)).toBe(hashText(stored));
  });
});

describe("compareTexts truth table", () => {
  const [a, b, c] = [hashText("a"), hashText("b"), hashText("c")];
  it("none when both sides are equal now, whatever the base", () => {
    expect(compareTexts(a, b, b)).toBe("none");
    expect(compareTexts(undefined, b, b)).toBe("none");
    expect(compareTexts(a, a, a)).toBe("none");
  });
  it("send when only Product Velocity changed", () => expect(compareTexts(a, b, a)).toBe("send"));
  it("github when only GitHub changed", () => expect(compareTexts(a, a, b)).toBe("github"));
  it("both when both changed to different texts", () => expect(compareTexts(a, b, c)).toBe("both"));
  it("without a base a difference is a conflict with no default", () => expect(compareTexts(undefined, a, b)).toBe("both"));
});

import { compareIssue } from "./inbound";
describe("compareIssue", () => {
  const pv = { initiative_name: "Faster export", summary: "S", description: "D", hypothesis: "H" };
  const issueFor = (over: Record<string, unknown>, title = "R-12: Faster export") => ({ title, body: `Notes by engineers\n\n${build({ ...pv, ...over }).block}` });
  const inStep = Object.fromEntries((["title", "summary", "description", "hypothesis"] as const).map((f) => [f, hashText(f === "title" ? pv.initiative_name : pv[f])]));
  it("is in step when both sides say the same, with or without a base", () => {
    for (const base of [inStep, undefined]) expect(compareIssue({ code: "R-12", pv, issue: issueFor({}), base }).fields.map((f) => f.verdict)).toEqual(["none", "none", "none", "none"]);
  });
  it("a title edited only in GitHub is a GitHub-side change; a description edited only in PV is a send", () => {
    const r = compareIssue({ code: "R-12", pv: { ...pv, description: "D2" }, issue: issueFor({}, "R-12: Renamed in GitHub"), base: inStep });
    expect(Object.fromEntries(r.fields.map((f) => [f.field, f.verdict]))).toEqual({ title: "github", summary: "none", description: "send", hypothesis: "none" });
    expect(r.fields[0]).toMatchObject({ pvText: "Faster export", githubText: "Renamed in GitHub" });
  });
  it("both sides changed differently is a conflict with no default", () => {
    const r = compareIssue({ code: "R-12", pv: { ...pv, summary: "PV edit" }, issue: issueFor({ summary: "GitHub edit" }), base: inStep });
    expect(r.fields.find((f) => f.field === "summary")!.verdict).toBe("both");
  });
  it("an unreadable block gives only the name and a reason, and never a text from the block", () => {
    const r = compareIssue({ code: "R-12", pv, issue: { title: "R-12: Faster export", body: "the markers are gone" }, base: inStep });
    expect(r.fields.map((f) => f.field)).toEqual(["title"]);
    expect(r.blockProblem).toMatch(/markers/);
  });
  it("hostile text in GitHub is carried only as text for the field it sits in", () => {
    const evil = "value_12m=999999\ncustomers=Evil Corp <!-- pv:end --> @everyone";
    const r = compareIssue({ code: "R-12", pv, issue: issueFor({ description: evil }), base: inStep });
    const d = r.fields.find((f) => f.field === "description")!;
    expect(d.verdict).toBe("github");
    expect(d.githubText).not.toContain("<!--");
    expect(r.fields.filter((f) => f.field !== "description").every((f) => f.verdict === "none")).toBe(true);
  });
});
