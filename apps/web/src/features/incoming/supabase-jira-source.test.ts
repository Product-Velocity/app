import { describe, expect, it, vi } from "vitest";

const copyJiraIssueTexts = vi.fn(async (ids: string[]): Promise<Record<string, unknown>> => ({ copied: 0, failed: 0, asked: ids.length }));
const refreshPulledFromJira = vi.fn();
vi.mock("@/app/(workspace)/incoming/copy-jira-texts", () => ({ copyJiraIssueTexts: (ids: string[]) => copyJiraIssueTexts(ids), refreshPulledFromJira: (ids: string[]) => refreshPulledFromJira(ids) }));

import { mapJiraRow, SupabaseJiraIncomingSource } from "./supabase-jira-source";

const row = (o: Record<string, unknown> = {}) => ({ id: "a", project_id: "p1", jira_project_key: "PLAT", issue_key: "PLAT-12", title: "Checkout", issue_type: "Epic", labels: ["x"], status_category: "indeterminate", parent_key: null, html_url: "https://acme.atlassian.net/browse/PLAT-12", pull_state: "not_pulled", ignore_reason: null, item_id: null, jira_updated_at: "2026-11-01T10:00:00Z", ...o });

describe("Jira rows in the incoming list", () => {
  it("maps a Jira record into the shape the list shows: the project key is the group and the number is the key's number", () => {
    expect(mapJiraRow(row() as never)).toMatchObject({ repo: "PLAT", number: 12, state: "open", parentNumber: null, pullState: "not_pulled", issueType: "Epic" });
  });
  it("a Done issue reads as closed; a parent in the same Jira project is a parent, one elsewhere is not drawn", () => {
    expect(mapJiraRow(row({ status_category: "done" }) as never).state).toBe("closed");
    expect(mapJiraRow(row({ parent_key: "PLAT-3" }) as never).parentNumber).toBe(3);
    expect(mapJiraRow(row({ parent_key: "OTHER-3" }) as never).parentNumber).toBeNull();
  });
});

describe("pulling Jira issues in", () => {
  it("sends each issue to the project of its own Jira project, one call per project", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ id: "a", project_id: "p1" }, { id: "b", project_id: "p2" }, { id: "c", project_id: "p1" }], error: null }) }) }) }),
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: (args.p_ids as string[]).map((id) => ({ id, ok: true, reason: null, item_id: `item-${id}`, item_code: `R-${id}` })), error: null }; },
    };
    const source = new SupabaseJiraIncomingSource(client as never, "t1");
    const out = await source.pullIn(["a", "b", "c"], "ignored-by-jira", "push");
    expect(calls.map((c) => [c.fn, c.args.p_project, c.args.p_ids, c.args.p_mode])).toEqual([
      ["jira_pull_in", "p1", ["a", "c"], "push"],
      ["jira_pull_in", "p2", ["b"], "push"],
    ]);
    expect(out.map((o) => o.itemId)).toEqual(["item-a", "item-c", "item-b"]);
  });
  it("has no saved rules yet and says so", async () => {
    const source = new SupabaseJiraIncomingSource({} as never, "t1");
    expect(await source.addRule()).toEqual({ ok: false, error: "Rules are not available for Jira yet." });
  });
});

describe("keeping the Jira issue's text and labels (issue #365)", () => {
  const clientWith = () => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ id: "a", project_id: "p1" }], error: null }) }) }) }),
    rpc: async (_fn: string, args: Record<string, unknown>) => ({ data: (args.p_ids as string[]).map((id) => ({ id, ok: true, reason: null, item_id: `item-${id}`, item_code: "R-1" })), error: null }),
  });
  it("copies the text of the issues just pulled in, and reports an unreadable one without failing the pull-in", async () => {
    copyJiraIssueTexts.mockClear();
    const source = new SupabaseJiraIncomingSource(clientWith() as never, "t1");
    expect((await source.pullIn(["a"], "x", "follow"))[0]).toMatchObject({ ok: true, itemId: "item-a" });
    expect(copyJiraIssueTexts).toHaveBeenCalledWith(["item-a"]);
    copyJiraIssueTexts.mockResolvedValueOnce({ copied: 0, failed: 1 });
    expect((await source.pullIn(["a"], "x", "follow"))[0]!.note).toMatch(/could not be read from Jira/);
    copyJiraIssueTexts.mockRejectedValueOnce(new Error("boom"));
    expect((await source.pullIn(["a"], "x", "follow"))[0]).toMatchObject({ ok: true });
  });
  it("re-pull reports what was filled, asks to sign in again when Jira refuses, and answers plainly on a crash", async () => {
    const source = new SupabaseJiraIncomingSource(clientWith() as never, "t1");
    refreshPulledFromJira.mockResolvedValueOnce({ copied: 2, failed: 1, labelled: 3, checked: 4, noText: 1 });
    expect(await source.refreshPulled(["a"])).toEqual({ ok: true, checked: 4, descriptions: 2, labelled: 3, failed: 1, noText: 1 });
    refreshPulledFromJira.mockResolvedValueOnce({ copied: 0, failed: 2, checked: 2, reconnect: true });
    expect(await source.refreshPulled(["a"])).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in again/) });
    refreshPulledFromJira.mockRejectedValueOnce(new Error("boom"));
    expect(await source.refreshPulled(["a"])).toEqual({ ok: false, error: "Jira could not be asked just now. Try again." });
  });
});
