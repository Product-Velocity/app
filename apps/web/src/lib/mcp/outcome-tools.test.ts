import { describe, expect, it, vi } from "vitest";
import type { SearchRow, UsageResult } from "@pv/domain";
import { buildContext, type ItemDetail, type OutcomeReviewsInfo } from "./read-model";
import { handleRpc, TOOLS, type McpBackend } from "./rpc";
import { ToolInputError } from "./tool-error";
import type { McpOutcomes } from "./write-model";

type Out = { result: { isError?: boolean; content: { text: string }[] } };
const reviewsOf = (): OutcomeReviewsInfo => ({
  item: "R-01", name: "Faster onboarding", start_rollout: "2026-10-20", kr_metric: "Activation", kr_unit: "%",
  reviews: [
    { at_days: 30, due_on: "2026-11-19", state: "recorded", requested_at: "2026-11-19T00:00:00Z", recorded_at: "2026-11-20T00:00:00Z", realised_kr_value: 42, adoption_pct: 18, note: null, stated_words: "Dana: 42 and 18%" },
    { at_days: 60, due_on: "2026-12-19", state: "not_requested", requested_at: null, recorded_at: null, realised_kr_value: null, adoption_pct: null, note: null, stated_words: null },
    { at_days: 90, due_on: "2027-01-18", state: "not_requested", requested_at: null, recorded_at: null, realised_kr_value: null, adoption_pct: null, note: null, stated_words: null },
  ],
});
function setup(opts: { refuse?: string; noRollout?: boolean } = {}) {
  const recorded: { item: string; days: number; v: unknown }[] = [];
  const outcomes: McpOutcomes = {
    record: vi.fn(async (item, days, v) => {
      if (opts.refuse) throw new ToolInputError(opts.refuse);
      recorded.push({ item, days, v });
    }),
  };
  const detail = (ref: string): ItemDetail | null =>
    ref.toUpperCase() === "R-01" ? ({ row: { id: "i1", item_code: "R-01" } as SearchRow, links: [], tags: {}, relations: { depends_on: [], depended_on_by: [], related_to: [] }, teams: [], files: [], github: null, activity: [], updated: null } as unknown as ItemDetail) : null;
  const backend: McpBackend = {
    role: "creator",
    workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role: "creator", projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
    read: {
      itemDetail: vi.fn(async (r: string) => detail(r)),
      outcomeReviews: vi.fn(async (r: string) => (r.toUpperCase() === "R-01" ? (opts.noRollout ? { ...reviewsOf(), start_rollout: null } : reviewsOf()) : null)),
    } as never,
    write: { outcomes } as never,
    meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, backend, TOOLS)) as Out;
    const text = r.result.content[0]!.text;
    return { isError: r.result.isError === true, text, data: r.result.isError ? null : JSON.parse(text).data };
  };
  return { call, recorded, outcomes };
}
const GOOD = { item: "r-01", at_days: 60, realised_kr_value: 55, adoption_pct: 31, note: "Beta users", stated_by: "Dana said: 55 activations and 31% adoption at 60 days" };

describe("get_outcome_reviews", () => {
  it("returns the three checkpoints with their state in words and the words behind a Claude-recorded one", async () => {
    const r = await setup().call("get_outcome_reviews", { item: "r-01" });
    expect(r.data.reviews.map((x: { at_days: number; state: string }) => [x.at_days, x.state])).toEqual([[30, "recorded"], [60, "not_requested"], [90, "not_requested"]]);
    expect(r.data.reviews[0].stated_words).toBe("Dana: 42 and 18%");
  });
  it("says so when there is no Start Roll-Out, and refuses an unknown initiative", async () => {
    const s = setup({ noRollout: true });
    expect(JSON.stringify((await s.call("get_outcome_reviews", { item: "R-01" })).data.notes)).toMatch(/no Start Roll-Out/);
    const unknown = await s.call("get_outcome_reviews", { item: "R-99" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/No initiative/);
  });
  it("is a read tool", () => {
    const t = TOOLS.find((x) => x.name === "get_outcome_reviews")!;
    expect(t.mode).toBe("read");
    expect((t.annotations as { readOnlyHint: boolean }).readOnlyHint).toBe(true);
  });
});

describe("record_outcome_review (numbers a person stated)", () => {
  it("records the numbers with the person's words and says nothing was requested or sent", async () => {
    const s = setup();
    const r = await s.call("record_outcome_review", GOOD);
    expect(s.recorded).toEqual([{ item: "i1", days: 60, v: { value: 55, adoption: 31, note: "Beta users", words: "Dana said: 55 activations and 31% adoption at 60 days" } }]);
    expect(r.data).toMatchObject({ status: "recorded", item: "R-01", at_days: 60 });
    expect(JSON.stringify(r.data.notes)).toMatch(/Nothing was requested from anyone/);
  });

  it("refuses without the person's words, without any number or note, with a bad checkpoint or percentage, and for an unknown initiative, before anything is written", async () => {
    const s = setup();
    for (const bad of [
      { ...GOOD, stated_by: "  " }, { ...GOOD, stated_by: undefined },
      { item: "R-01", at_days: 30, stated_by: "said so" },
      { ...GOOD, at_days: 45 }, { ...GOOD, adoption_pct: 120 }, { ...GOOD, realised_kr_value: "lots" },
      { ...GOOD, item: "R-99" },
    ]) expect((await s.call("record_outcome_review", bad as never)).isError, JSON.stringify(bad)).toBe(true);
    expect(s.outcomes.record).not.toHaveBeenCalled();
  });

  it("shows the database's reason (already recorded, no Start Roll-Out, role) as the message", async () => {
    const r = await setup({ refuse: "The 60 day review is already recorded; a person changes it in the app" }).call("record_outcome_review", GOOD);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/already recorded/);
  });

  it("is a write tool, never destructive, and the description tells Claude not to invent numbers", () => {
    const t = TOOLS.find((x) => x.name === "record_outcome_review")!;
    expect(t.mode).toBe("write");
    expect((t.annotations as { destructiveHint: boolean }).destructiveHint).toBe(false);
    expect(t.description).toMatch(/Never estimate, calculate or invent/);
    expect((t.inputSchema as { required: string[] }).required).toContain("stated_by");
  });
});
