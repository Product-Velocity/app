import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithOtp } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://app.example" }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { sendSignInLink } from "./actions";

const form = (email: string, next = "/") => {
  const f = new FormData();
  f.set("email", email);
  f.set("next", next);
  return f;
};

describe("sendSignInLink (emailed one-time link)", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null });
  });

  it("never creates an account", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await sendSignInLink(null, form("Ada@Example.com"));
    const arg = signInWithOtp.mock.calls[0][0];
    expect(arg.options.shouldCreateUser).toBe(false);
    expect(arg.email).toBe("ada@example.com");
  });

  it("answers the same for a known address, an unknown address, a send error and a rate limit", async () => {
    const answers = [];
    for (const result of [{ error: null }, { error: { status: 422, message: "Signups not allowed for otp" } }, { error: { status: 429 } }]) {
      signInWithOtp.mockResolvedValueOnce(result);
      const r = await sendSignInLink(null, form("someone@example.com"));
      answers.push({ sent: r?.sent, email: r?.email, error: r?.error });
    }
    signInWithOtp.mockRejectedValueOnce(new Error("network"));
    const r = await sendSignInLink(null, form("someone@example.com"));
    answers.push({ sent: r?.sent, email: r?.email, error: r?.error });
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ sent: true, email: "someone@example.com", error: undefined });
  });

  it("sends nothing for an address that is not an email", async () => {
    const r = await sendSignInLink(null, form("not-an-email"));
    expect(r?.sent).toBe(false);
    expect(r?.error).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("signs a verified linked address in as the person's own address", async () => {
    rpc.mockResolvedValue({ data: "main@example.com" });
    signInWithOtp.mockResolvedValue({ error: null });
    await sendSignInLink(null, form("alias@example.com"));
    expect(signInWithOtp.mock.calls[0][0].email).toBe("main@example.com");
  });

  it("only returns to a same-site path", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await sendSignInLink(null, form("a@example.com", "https://evil.example/steal"));
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://app.example/auth/callback?next=%2F",
    );
  });
});
