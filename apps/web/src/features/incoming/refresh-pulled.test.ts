import { describe, expect, it, vi } from "vitest";

const refreshPulledFromGithub = vi.fn();
vi.mock("@/app/(workspace)/incoming/copy-descriptions", () => ({ copyIssueDescriptions: vi.fn(), refreshPulledFromGithub: (...a: unknown[]) => refreshPulledFromGithub(...a) }));

const { SupabaseIncomingSource } = await import("./supabase-source");
const source = () => new SupabaseIncomingSource({} as never, "t1");

describe("SupabaseIncomingSource.refreshPulled (re-pull)", () => {
  it("passes the initiatives on and reports what was filled", async () => {
    refreshPulledFromGithub.mockResolvedValueOnce({ copied: 2, failed: 1, labelled: 3, checked: 4, noText: 1 });
    expect(await source().refreshPulled(["a", "b"])).toEqual({ ok: true, checked: 4, descriptions: 2, labelled: 3, failed: 1, noText: 1 });
    expect(refreshPulledFromGithub).toHaveBeenCalledWith(["a", "b"]);
  });
  it("answers with a plain message when the server action throws", async () => {
    refreshPulledFromGithub.mockRejectedValueOnce(new Error("boom"));
    expect(await source().refreshPulled(["a"])).toEqual({ ok: false, error: "GitHub could not be asked just now. Try again." });
  });
});
