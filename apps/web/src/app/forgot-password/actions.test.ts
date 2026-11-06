import { beforeEach, describe, expect, it, vi } from "vitest";

const resetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { resetPasswordForEmail } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: null }) }) }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://app.example" }));

import { requestPasswordReset } from "./actions";

const form = (email: string) => {
  const f = new FormData();
  f.set("email", email);
  return f;
};

describe("requestPasswordReset", () => {
  beforeEach(() => resetPasswordForEmail.mockReset());

  it("gives the same answer whether or not the send worked", async () => {
    const seen = new Set<string>();
    for (const result of [{ error: null }, { error: { status: 429 } }, { error: { status: 400 } }]) {
      resetPasswordForEmail.mockResolvedValueOnce(result);
      const r = await requestPasswordReset(null, form("a@example.com"));
      seen.add(JSON.stringify({ sent: r?.sent, email: r?.email, error: r?.error }));
    }
    resetPasswordForEmail.mockRejectedValueOnce(new Error("down"));
    const r = await requestPasswordReset(null, form("a@example.com"));
    seen.add(JSON.stringify({ sent: r?.sent, email: r?.email, error: r?.error }));
    expect(seen.size).toBe(1);
  });

  it("comes back through the callback to the reset page", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    await requestPasswordReset(null, form("A@Example.com"));
    expect(resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "https://app.example/auth/callback?next=%2Freset-password",
    });
  });

  it("sends nothing for something that is not an email", async () => {
    const r = await requestPasswordReset(null, form("nope"));
    expect(r?.sent).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
