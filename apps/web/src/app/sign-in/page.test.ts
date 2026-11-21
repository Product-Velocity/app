import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
let email: string | null = null;
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: email ? { email } : null } }) } }) }));
vi.mock("@/components/auth-shell", () => ({ AuthShell: () => null }));
vi.mock("@/components/auth-providers", () => ({ AuthProviders: () => null }));
vi.mock("./sign-in-form", () => ({ PasswordForm: () => null }));

import SignInPage from "./page";

describe("/sign-in is a clean sign-in that the demo session never takes over", () => {
  beforeEach(() => {
    redirect.mockReset();
    process.env.DEMO_VIEWER_EMAIL = "demo@example.test";
  });
  const open = () => SignInPage({ searchParams: Promise.resolve({}) });

  it("lets a person sign in while the shared demo session is still in the browser", async () => {
    email = "Demo@Example.test";
    await open();
    expect(redirect).not.toHaveBeenCalled();
  });
  it("sends a real signed-in session on to the app", async () => {
    email = "person@example.test";
    await open();
    expect(redirect).toHaveBeenCalledWith("/app");
  });
  it("shows the form when nobody is signed in", async () => {
    email = null;
    await open();
    expect(redirect).not.toHaveBeenCalled();
  });
});
