import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

import { POST } from "./route";

describe("POST /auth/sign-out", () => {
  it("ends only this browser's session, so a connected Claude stays signed in", async () => {
    const form = new FormData();
    const res = await POST(
      new Request("https://app.test/auth/sign-out", { method: "POST", body: form }) as never,
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
  });
});
