import { describe, expect, it } from "vitest";
import { loadPublicLogo, type PublicLogoDeps } from "./public-logo";

const TOKEN = "a".repeat(32);
const sha = "b".repeat(64);
const deps = (row: Awaited<ReturnType<PublicLogoDeps["brandByToken"]>>, bytes: Uint8Array | null = Uint8Array.from([1, 2, 3])): PublicLogoDeps & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, brandByToken: async (t) => { asked.push(t); return row; }, read: async () => bytes };
};

describe("the public logo address", () => {
  it("serves the logo of a confirmed brand", async () => {
    const r = await loadPublicLogo(TOKEN, deps({ status: "confirmed", logo_path: "brand/t/x.png", logo_sha: sha }));
    expect(r && [...r.bytes, r.sha]).toEqual([1, 2, 3, sha]);
  });
  it("serves nothing for a draft, a brand without a logo, an unknown token or a missing file, and all look the same", async () => {
    expect(await loadPublicLogo(TOKEN, deps({ status: "draft", logo_path: "brand/t/x.png", logo_sha: sha }))).toBeNull();
    expect(await loadPublicLogo(TOKEN, deps({ status: "confirmed", logo_path: null, logo_sha: null }))).toBeNull();
    expect(await loadPublicLogo(TOKEN, deps(null))).toBeNull();
    expect(await loadPublicLogo(TOKEN, deps({ status: "confirmed", logo_path: "brand/t/x.png", logo_sha: sha }, null))).toBeNull();
  });
  it("does not even look up a token that is not 32 hex characters (no guessing by id or by path)", async () => {
    const d = deps({ status: "confirmed", logo_path: "brand/t/x.png", logo_sha: sha });
    for (const bad of ["", "../etc/passwd", "A".repeat(32), "a".repeat(31), "a".repeat(33), "8fffef0f-d3df-4677-9cc5-5856efc5838f"]) expect(await loadPublicLogo(bad, d)).toBeNull();
    expect(d.asked).toEqual([]);
  });
});
