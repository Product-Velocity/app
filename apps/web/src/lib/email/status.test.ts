import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { emailStatus, forgetEmailStatus } from "./status";
import { EMAIL_TEMPLATES, defaultEmailStatus } from "./registry/registry";

beforeEach(() => { rpc.mockReset(); for (const t of EMAIL_TEMPLATES) forgetEmailStatus(t.key); });

describe("email status (Active or Paused)", () => {
  it("a sign-in, confirmation, reset or code email and an alignment mailing is always active and never asks the database", async () => {
    for (const k of ["auth.sign-in-link", "auth.confirm-signup", "auth.reset-password", "app.link-code", "alignment.invitation"] as const) expect(await emailStatus(k)).toBe("active");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("with no row, the personal notes are paused and every other email is active", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await emailStatus("app.welcome-personal")).toBe("paused");
    expect(await emailStatus("app.followup-personal")).toBe("paused");
    expect(await emailStatus("app.invitation")).toBe("active");
  });
  it("the console's choice wins, both ways", async () => {
    rpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await emailStatus("app.welcome-personal")).toBe("active");
    rpc.mockResolvedValueOnce({ data: "paused", error: null });
    expect(await emailStatus("app.invitation")).toBe("paused");
  });
  it("if the store cannot be read, the template's default stands: a note is not started, an invitation is not stopped", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await emailStatus("app.welcome-personal")).toBe("paused");
    forgetEmailStatus("app.invitation");
    expect(await emailStatus("app.invitation")).toBe("active");
  });
  it("only the three listed statuses are accepted from the database", async () => {
    rpc.mockResolvedValue({ data: "maybe", error: null });
    expect(await emailStatus("app.invitation")).toBe("active");
  });
});

describe("which emails can be paused", () => {
  it("only app and site emails: never auth, never alignment, never the link code", () => {
    const pausable = EMAIL_TEMPLATES.filter((t) => !t.alwaysOn).map((t) => t.key);
    for (const k of pausable) expect(k.startsWith("auth.") || k.startsWith("alignment.") || k === "app.link-code", k).toBe(false);
    for (const t of EMAIL_TEMPLATES) if (t.key.startsWith("auth.") || t.key.startsWith("alignment.") || t.key === "app.link-code") expect(t.alwaysOn, t.key).toBe(true);
  });
  it("starts the personal notes paused and everything else active", () => {
    for (const t of EMAIL_TEMPLATES) expect(defaultEmailStatus(t), t.key).toBe(t.personal ? "paused" : "active");
  });
});
