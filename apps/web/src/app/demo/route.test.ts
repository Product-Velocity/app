import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = { getUser: vi.fn(), signOut: vi.fn(), signInWithPassword: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("@/lib/session", () => ({ rememberTenant: vi.fn() }));

import { GET } from "./route";

const call = () => GET(new NextRequest("https://app.example/demo"));
const where = (res: Response) => new URL(res.headers.get("location")!).pathname;

beforeEach(() => {
  vi.stubEnv("DEMO_VIEWER_EMAIL", "demo@example.com");
  vi.stubEnv("DEMO_VIEWER_PASSWORD", "pw");
  vi.stubEnv("DEMO_TENANT_ID", "00000000-0000-0000-0000-000000000001");
  auth.getUser.mockReset();
  auth.signOut.mockReset().mockResolvedValue({});
  auth.signInWithPassword.mockReset().mockResolvedValue({ error: null });
});

describe("GET /demo", () => {
  it("never replaces the session of someone signed in to their own account", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { email: "me@company.com" } } });
    const res = await call();
    expect(where(res)).toBe("/app");
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("signs a signed-out visitor into the demo account", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(where(res)).toBe("/portfolio");
  });
  it("lets someone already in the demo account start it again", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { email: "Demo@Example.com" } } });
    const res = await call();
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(where(res)).toBe("/portfolio");
  });
});
