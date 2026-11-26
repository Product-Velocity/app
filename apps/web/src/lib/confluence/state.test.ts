import { describe, expect, it } from "vitest";
import type { ConfluenceRequest } from "./client";
import { documentSyncState } from "./state";

const page = (version: number) => ({ id: "5", title: "PRD", version: { number: version }, spaceId: "9", _links: { webui: "/spaces/X/pages/5" } });
const fake = (status: number, json: unknown): { call: ConfluenceRequest; calls: string[] } => { const calls: string[] = []; return { calls, call: async (m, p) => { calls.push(`${m} ${p}`); return { status, json }; } }; };
const link = (direction: "from_confluence" | "to_confluence" | "both") => ({ direction, pageId: "5", publishedVersion: 3, remoteVersion: 5 });

describe("documentSyncState: what a linked document needs", () => {
  it("a write-only link asks nothing of Confluence", async () => {
    const f = fake(200, page(9));
    expect(await documentSyncState(f.call, null, link("to_confluence"), 4)).toEqual({ state: "send", pageVersion: null });
    expect(f.calls).toHaveLength(0);
  });
  it("a read link and a two-way link read the page's version and compare", async () => {
    expect((await documentSyncState(fake(200, page(6)).call, null, link("from_confluence"), 3)).state).toBe("receive");
    expect((await documentSyncState(fake(200, page(5)).call, null, link("both"), 3)).state).toBe("in_step");
    expect((await documentSyncState(fake(200, page(6)).call, null, link("both"), 4)).state).toBe("conflict");
  });
  it("a deleted page is gone, and a page that could not be read is unknown (nothing is guessed)", async () => {
    expect((await documentSyncState(fake(404, null).call, null, link("both"), 3)).state).toBe("gone");
    expect((await documentSyncState(fake(500, null).call, null, link("both"), 3)).state).toBe("unknown");
  });
});
