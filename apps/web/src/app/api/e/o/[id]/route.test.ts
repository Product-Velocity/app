import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let misconfigured = false;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (misconfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set"); // what the real one does without its settings
    return { rpc };
  },
}));

import { GET } from "./route";

const call = (id: string) => GET(new Request(`https://pv.test/api/e/o/${id}`), { params: Promise.resolve({ id }) });
const GOOD = "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b";

beforeEach(() => { rpc.mockReset(); misconfigured = false; });

describe("open pixel route", () => {
  it("records the open and answers with a GIF that is never cached", async () => {
    rpc.mockResolvedValue({ error: null });
    const res = await call(GOOD);
    expect(rpc).toHaveBeenCalledWith("record_email_open", { p_id: GOOD });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).subarray(0, 6))).toBe("GIF89a");
  });
  it("ignores an id that is not a UUID without touching the database", async () => {
    for (const bad of ["abc", "../../x", `${GOOD}x`]) {
      const res = await call(bad);
      expect(res.status).toBe(200);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("still serves the image when the database answers with an error", async () => {
    rpc.mockResolvedValue({ error: { message: "down" } });
    expect((await call(GOOD)).status).toBe(200);
  });
  it("still serves the image when the server is not configured", async () => {
    misconfigured = true;
    expect((await call(GOOD)).status).toBe(200);
  });
});
