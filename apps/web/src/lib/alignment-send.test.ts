import { describe, expect, it, vi } from "vitest";
import { sendMailing, type SendDeps } from "./alignment-send";

const people = [{ id: "p1", email: "ann.secret@example.test", name: "Ann Secret" }, { id: "p2", email: "bob.secret@example.test", name: null }, { id: "p3", email: "cy.secret@example.test", name: null }];
const mailing = { id: "m1", kind: "invitation" as const, subject: "Vote {{session}}", body: "Hi {{name}}", status: "confirmed", sessionName: "Q1", closesAt: null };

function deps(over: Partial<SendDeps> & { confirmed?: boolean } = {}) {
  const calls: string[] = [];
  const sent: { to: string; text: string }[] = [];
  const logs: string[] = [];
  const d: SendDeps = {
    rpc: async (fn, args) => {
      calls.push(fn);
      if (fn === "alignment_mailing_recipients") return over.confirmed === false ? { data: null, error: { code: "PV010", message: "This mailing has not been confirmed by a person." } } : { data: people, error: null };
      if (fn === "alignment_mailing_issue") expect(String(args.p_token_hash)).toMatch(/^[0-9a-f]{64}$/);
      return { data: null, error: null };
    },
    mailing: async () => mailing,
    send: async (m) => { sent.push(m); return { ok: true, id: "re_1" }; },
    site: "https://pv.example",
    log: (l) => logs.push(l),
    ...over,
  };
  return { d, calls, sent, logs };
}

describe("sendMailing", () => {
  it("sends nothing and asks for no address when the mailing is not confirmed", async () => {
    const { d, calls, sent } = deps({ confirmed: false });
    const r = await sendMailing("m1", d);
    expect(r).toMatchObject({ sent: 0, stopped: "This mailing has not been confirmed by a person." });
    expect(sent).toHaveLength(0);
    expect(calls).toEqual(["alignment_mailing_recipients"]);
  });
  it("sends one email per person with a personal link, and records each result", async () => {
    const { d, calls, sent } = deps();
    const r = await sendMailing("m1", d);
    expect(r).toEqual({ sent: 3, failed: 0, left: 0 });
    expect(sent.map((s) => s.to).sort()).toEqual(people.map((p) => p.email).sort());
    const links = sent.map((s) => /https:\/\/pv\.example\/a\/([\w-]+)/.exec(s.text)![1]);
    expect(new Set(links).size).toBe(3);
    expect(calls.filter((c) => c === "alignment_mailing_result")).toHaveLength(3);
  });
  it("never writes an address, a name or a link to the log, even when sending fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const logs: string[] = [];
    const { d } = deps({ send: async () => ({ ok: false, error: "The email service rejected the address or the sender." }), log: (l) => { logs.push(l); console.error(l); } });
    d.rpc = async (fn) => (fn === "alignment_mailing_result" ? { data: null, error: { code: "XX000", message: "boom for ann.secret@example.test" } } : fn === "alignment_mailing_recipients" ? { data: people, error: null } : { data: null, error: null });
    const r = await sendMailing("m1", d);
    expect(r.failed).toBe(3);
    const everything = JSON.stringify([logs, spy.mock.calls, out.mock.calls]);
    expect(logs.length).toBeGreaterThan(0);
    expect(everything).not.toMatch(/secret@example|Ann Secret|\/a\//);
    spy.mockRestore(); out.mockRestore();
  });
  it("stops when the email service rate limits, and leaves the rest for Continue sending", async () => {
    let n = 0;
    const { d } = deps({ send: async () => (++n === 1 ? { ok: true as const, id: "x" } : { ok: false as const, error: "The email service is rate limiting us; try again in a minute." }) });
    const r = await sendMailing("m1", d);
    expect(r.sent).toBe(1);
    expect(r.stopped).toMatch(/rate limiting/);
    expect(r.left).toBeGreaterThanOrEqual(0);
  });
  it("stops at the time budget", async () => {
    let t = 0;
    const { d } = deps({ budgetMs: 10, now: () => (t += 20) });
    const r = await sendMailing("m1", d);
    expect(r.stopped).toMatch(/Continue sending/);
    expect(r.left).toBeGreaterThan(0);
  });
});
