import { describe, expect, it } from "vitest";
import { buildDigest, digestMarkdown, type DigestInput } from "./leadership-digest";
import type { FeedRow } from "./change-report";
import { parseUpdate, updateToHtml, updateToPlain } from "./update-format";

const rows = [
  { id: "a", item_code: "R-71", initiative_name: "Reporting API Improvements", stack_rank: 1 },
  { id: "b", item_code: "R-72", initiative_name: "Manager Notificator", stack_rank: 2 },
  { id: "c", item_code: "R-22", initiative_name: "MCP server for GAM", stack_rank: 3 },
  { id: "d", item_code: "R-24", initiative_name: "Bidder Adapter", stack_rank: 4 },
  { id: "e", item_code: "R-26", initiative_name: "Publisher Dashboard [Phase 1]", stack_rank: 5 },
];
let n = 0;
const f = (item_id: string, entity: string, field: string, old: unknown, nw: unknown, at: string): FeedRow => ({ id: ++n, item_id, entity, field, old, new: nw, at, actor_id: "u1", via: "UI" });
const feed: FeedRow[] = [
  // R-72: Jira bounced around in one day and ended Done; Build Status followed
  f("b", "item_jira_links", "jira_status", "To Do", "In Progress", "2026-11-17T08:00:00Z"), f("b", "items", "status", "Not started", "In progress", "2026-11-17T08:00:00Z"),
  f("b", "item_jira_links", "jira_status", "In Progress", "Done", "2026-11-17T09:00:00Z"), f("b", "items", "status", "In progress", "Done", "2026-11-17T09:00:00Z"),
  f("b", "item_jira_links", "jira_status", "Done", "In Progress", "2026-11-17T10:00:00Z"), f("b", "items", "status", "Done", "In progress", "2026-11-17T10:00:00Z"),
  f("b", "item_jira_links", "jira_status", "In Progress", "Done", "2026-11-17T11:00:00Z"), f("b", "items", "status", "In progress", "Done", "2026-11-17T11:00:00Z"),
  // R-71: bounced and ended where it started: not a change
  f("a", "item_jira_links", "jira_status", "To Do", "Done", "2026-11-17T08:00:00Z"), f("a", "item_jira_links", "jira_status", "Done", "To Do", "2026-11-17T09:00:00Z"),
  // phases
  f("c", "items", "initiative_phase", "Build", "Test", "2026-11-16T09:00:00Z"),
  f("d", "items", "initiative_phase", "Roll-out", "Completed", "2026-11-16T09:00:00Z"),
  f("e", "items", "initiative_phase", "Test", "Build", "2026-11-16T09:00:00Z"),
  f("a", "items", "initiative_phase", null, "Discover", "2026-11-12T09:00:00Z"), // a first phase is "entered", not a move
  // health
  f("c", "items", "health", "At Risk", "On Track", "2026-11-17T09:00:00Z"),
  f("d", "items", "health", "On Track", "Blocked", "2026-11-17T09:00:00Z"),
  // outside the scope
  f("zzz", "items", "initiative_phase", "Build", "Test", "2026-11-16T09:00:00Z"),
];
const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  feed, rows, periodLabel: "this week",
  trackers: new Map([["b", { tracker: "Jira" as const, key: "R8P-7049", title: "Notificator", url: "https://jira.test/browse/R8P-7049" }]]),
  documents: [{ id: "doc1", itemId: "e", entry: "document", title: "Session metrics PRD", kind: "prd", aiDraft: true, at: "2026-11-17T09:00:00Z" }, { id: "f1", itemId: "a", entry: "file", title: "mock.png", kind: null, aiDraft: false, at: "2026-11-16T09:00:00Z" }],
  rankMoves: [{ itemId: "a", kind: "rank", text: "", at: "2026-11-17T00:00:00Z", from: 9, to: 6 }],
  flags: new Map([["b", [{ kind: "tracker-done-open", label: "Tracker done, initiative open", text: "The tracker says the work is done.", action: { type: "move" as const, to: "Test" as const, label: "Move to Test" } }]]]),
  itemHref: (c) => `https://pv.test/portfolio?item=${c}`, documentHref: (c, d) => `https://pv.test/portfolio?item=${c}&tab=spec${d.entry === "document" ? `&doc=${d.id}` : ""}`, changesHref: "https://pv.test/reports?report=changes", ...over,
});
const text = (l: { text: string }[]) => l.map((p) => p.text).join("");
const group = (d: ReturnType<typeof buildDigest>, id: string) => d.groups.find((g) => g.id === id);

describe("buildDigest", () => {
  const d = buildDigest(input());
  it("sums a day of back and forth into one outcome and drops what ended where it began", () => {
    const build = group(d, "build")!;
    expect(build.lines).toHaveLength(1); // R-72 once; R-71 ended where it started
    expect(text(build.lines[0]!)).toBe("R-72 Manager Notificator: Jira R8P-7049 moved from To Do to Done. Build Status in Product Velocity: Not started to Done.");
  });
  it("names phase moves as moves, and Completed gets its own group", () => {
    expect(text(group(d, "completed")!.lines[0]!)).toBe("R-24 Bidder Adapter was completed (it moved from Roll-out to Completed).");
    expect(group(d, "phase")!.lines.map(text)).toEqual(["R-22 MCP server for GAM moved from Build to Test.", "R-26 Publisher Dashboard Phase 1 moved back from Test to Build.", "R-71 Reporting API Improvements entered Discover."]); // furthest phase first
  });
  it("lists health worse first, with the words", () => {
    expect(group(d, "health")!.lines.map(text)).toEqual(["R-24 Bidder Adapter health is now Blocked (was On Track).", "R-22 MCP server for GAM health is now On Track (was At Risk)."]);
  });
  it("shows rank as a net move", () => {
    expect(text(group(d, "priority")!.lines[0]!)).toBe("R-71 Reporting API Improvements moved up 3 places (#9 to #6).");
  });
  it("makes initiatives, tickets and documents links", () => {
    const build = group(d, "build")!.lines[0]!;
    expect(build.find((p) => p.text === "R8P-7049")!.href).toBe("https://jira.test/browse/R8P-7049");
    expect(build[0]!.href).toBe("https://pv.test/portfolio?item=R-72");
    const docs = group(d, "documents")!.lines;
    expect(docs[0]!.find((p) => p.text === "Session metrics PRD")!.href).toBe("https://pv.test/portfolio?item=R-26&tab=spec&doc=doc1");
    expect(text(docs[0]!)).toContain("(PRD, AI draft, not yet reviewed) added to R-26");
    expect(text(docs[1]!)).toBe("mock.png (File) added to R-71 Reporting API Improvements.");
  });
  it("flags what needs a person on an initiative that moved, with the suggestion", () => {
    expect(text(group(d, "followup")!.lines[0]!)).toBe("R-72 Manager Notificator: Tracker done, initiative open. The tracker says the work is done. Suggested: Move to Test.");
  });
  it("ignores initiatives outside the scope and has a headline that counts", () => {
    expect(d.itemIds).not.toContain("zzz");
    expect(d.headline).toBe("5 initiatives moved this week: 1 completed, 3 phase moves, 2 health changes, 1 priority change, 1 tracker update, 2 new documents or files.");
  });
  it("is calm when nothing moved", () => {
    const quiet = buildDigest(input({ feed: [], documents: [], rankMoves: [] }));
    expect(quiet.headline).toBe("No phase, health, priority, tracker or document changes this week.");
    expect(quiet.groups).toEqual([]);
  });
  it("cuts a long group and points to the Changes report", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, item_code: `R-${100 + i}`, initiative_name: `Item ${i}`, stack_rank: 10 + i }));
    const big = buildDigest(input({ rows: many, feed: many.map((r) => f(r.id, "items", "initiative_phase", "Build", "Test", "2026-11-16T09:00:00Z")), documents: [], rankMoves: [], flags: new Map() }));
    const lines = group(big, "phase")!.lines;
    expect(lines).toHaveLength(7);
    expect(text(lines[6]!)).toBe("and 3 more in the Changes report");
    expect(lines[6]![0]!.href).toBe("https://pv.test/reports?report=changes");
  });
  it("never names a person", () => {
    expect(JSON.stringify(d)).not.toContain("u1");
  });
});

describe("the update as an email", () => {
  const md = digestMarkdown(buildDigest(input())).join("\n");
  it("writes links as Markdown links, brackets in names removed", () => {
    expect(md).toContain("[R-72 Manager Notificator](https://pv.test/portfolio?item=R-72)");
    expect(md).toContain("[R8P-7049](https://jira.test/browse/R8P-7049)");
    expect(md).toContain("[R-26 Publisher Dashboard Phase 1](https://pv.test/portfolio?item=R-26)");
  });
  it("turns the text into HTML with working links, escaped", () => {
    const html = updateToHtml(`Week 47\n\nHighlights\n- [R-1 <b>x</b>](https://a.test/x?y=1&z=2) done\n\n**Health**\n- plain & simple`);
    expect(html).toContain('<a href="https://a.test/x?y=1&amp;z=2">R-1 &lt;b&gt;x&lt;/b&gt;</a>');
    expect(html).toContain("<strong>Highlights</strong>");
    expect(html).toContain("<strong>Health</strong>");
    expect(html).toContain("plain &amp; simple");
    expect(html).not.toContain("<b>");
  });
  it("keeps only http and https as links", () => {
    expect(updateToHtml("t\n- [x](javascript:alert(1))")).not.toContain("<a ");
    expect(parseUpdate("t\n- [x](https://ok.test)")[1]).toMatchObject({ type: "list" });
  });
  it("gives plain text where a link reads label (address) and lists keep their dashes", () => {
    expect(updateToPlain("Week 47\n\nHighlights\n- [R-1 Name](https://a.test/x) done\n- second")).toBe("Week 47\n\nHighlights\n- R-1 Name (https://a.test/x) done\n- second");
  });
});
