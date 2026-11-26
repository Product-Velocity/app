import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "a".repeat(43);
const { verifyOtp, exchangeCodeForSession, getAal, rpc, rememberTenant } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getAal: vi.fn(),
  rpc: vi.fn(),
  rememberTenant: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession, mfa: { getAuthenticatorAssuranceLevel: getAal } }, rpc }),
}));
vi.mock("@/lib/session", () => ({ rememberTenant }));

import { GET, POST } from "./route";

const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request("https://app.test/auth/callback", { method: "POST", body: form }) as never);
};
const where = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
  getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
  rpc.mockResolvedValue({ data: "tenant-1", error: null });
});

describe("GET /auth/callback", () => {
  it("never uses the one-time token: it hands the link to the Continue page", async () => {
    const res = await GET(new Request(`https://app.test/auth/callback?token_hash=h1&type=signup&next=${encodeURIComponent(`/invite/${TOKEN}`)}`) as never);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(where(res)).toBe(`/auth/confirm?token_hash=h1&type=signup&next=${encodeURIComponent(`/invite/${TOKEN}`)}`);
  });
  it("still exchanges an OAuth code", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(new Request("https://app.test/auth/callback?code=c1&next=%2Fportfolio") as never);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("c1");
    expect(where(res)).toBe("/portfolio");
  });
  it("sends a link with nothing usable to sign-in", async () => {
    expect(where(await GET(new Request("https://app.test/auth/callback") as never))).toBe("/sign-in?error=callback");
  });
});

describe("POST /auth/callback", () => {
  it("verifies the token and accepts the invitation in the same step", async () => {
    const res = await post({ token_hash: "h1", type: "signup", next: `/invite/${TOKEN}` });
    expect(res.status).toBe(303);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h1", type: "signup" });
    expect(rpc).toHaveBeenCalledWith("accept_invitation", { p_token: TOKEN });
    expect(rememberTenant).toHaveBeenCalledWith("tenant-1");
    expect(where(res)).toBe("/onboarding/welcome");
  });
  it("leaves the invitation for the invitation page when two-factor is still to do", async () => {
    getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    const res = await post({ token_hash: "h1", type: "email", next: `/invite/${TOKEN}` });
    expect(rpc).not.toHaveBeenCalled();
    expect(where(res)).toBe(`/invite/${TOKEN}`);
  });
  it("lets the invitation page explain when accepting fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    expect(where(await post({ token_hash: "h1", type: "email", next: `/invite/${TOKEN}` }))).toBe(`/invite/${TOKEN}`);
    expect(rememberTenant).not.toHaveBeenCalled();
  });
  it("sends a used-up invitation link back to its invitation page", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect(where(await post({ token_hash: "h1", type: "signup", next: `/invite/${TOKEN}` }))).toBe(`/invite/${TOKEN}?link=used`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not accept anything for other links", async () => {
    expect(where(await post({ token_hash: "h1", type: "recovery", next: "/reset-password" }))).toBe("/reset-password");
    expect(rpc).not.toHaveBeenCalled();
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect(where(await post({ token_hash: "h1", type: "recovery", next: "/reset-password" }))).toBe("/sign-in?error=callback");
  });
  it("refuses a body without a token", async () => {
    expect(where(await post({ next: "/x" }))).toBe("/sign-in?error=callback");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
