import { describe, expect, it } from "vitest";
import { CLAUDE_CAN, CLAUDE_CANNOT, claudeMayWrite, limitMessage, refusalFor } from "./claude";

describe("what Claude may do for a role", () => {
  it("only creators and admins may use write tools", () => {
    expect(claudeMayWrite("creator")).toBe(true);
    expect(claudeMayWrite("admin")).toBe(true);
    for (const r of ["viewer", "commenter", "leadership", "", "owner"]) expect(claudeMayWrite(r)).toBe(false);
  });
  it("the plain lists name the things Claude never does", () => {
    const cannot = CLAUDE_CANNOT.join(" ").toLowerCase();
    for (const w of ["approve", "stack rank", "decision", "value", "delete", "roles"]) expect(cannot).toContain(w);
    expect(CLAUDE_CAN.length).toBeGreaterThanOrEqual(4);
  });
});

describe("refusals", () => {
  it("each connection status has a clear message", () => {
    expect(refusalFor("revoked")).toMatchObject({ http: 401 });
    expect(refusalFor("revoked")!.message).toMatch(/revoked/i);
    expect(refusalFor("no_connection")!.http).toBe(401);
    expect(refusalFor("workspace_off")).toMatchObject({ http: 403 });
    expect(refusalFor("workspace_off")!.message).toMatch(/admin/i);
    expect(refusalFor("not_member")!.http).toBe(403);
    expect(refusalFor("ok")).toBeNull();
  });
});

describe("limitMessage", () => {
  it("explains each limit in words, with the number", () => {
    expect(limitMessage({ ok: false, reason: "workspace_items", limit: 200, used: 200 })).toMatch(/200 items/);
    expect(limitMessage({ ok: false, reason: "workspace_bytes", limit: 104857600, used: 1 })).toMatch(/100 MB/);
    expect(limitMessage({ ok: false, reason: "connection_calls", limit: 2000, used: 2000 })).toMatch(/2,000 calls/);
    expect(limitMessage({ ok: false, reason: "workspace_calls", limit: 10000, used: 1 })).toMatch(/10,000 calls/);
    expect(limitMessage({ ok: false, reason: "something_new", limit: 1, used: 1 })).toMatch(/limit/i);
  });
  it("says when it resets and never mentions tables or SQL", () => {
    const m = limitMessage({ ok: false, reason: "workspace_items", limit: 200, used: 200 });
    expect(m).toMatch(/tomorrow|midnight|UTC/i);
    expect(m).not.toMatch(/sql|table|ai_usage/i);
  });
});
