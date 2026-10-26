import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite-token";
import { buildParticipantEmail } from "@/lib/alignment-mail";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
export type MailingInfo = { id: string; kind: "invitation" | "reminder"; subject: string; body: string; status: string; sessionName: string; closesAt: string | null };
export type SendDeps = {
  rpc: Rpc;
  mailing: (id: string) => Promise<MailingInfo | null>;
  send: (m: { to: string; subject: string; text: string; html: string }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  site: string;
  /** Wall-clock budget in milliseconds; what is left is sent by "Continue sending". */
  budgetMs?: number;
  now?: () => number;
  log?: (line: string) => void;
};
export type SendReport = { sent: number; failed: number; left: number; stopped?: string };

/**
 * Sends a CONFIRMED mailing. The addresses come from alignment_mailing_recipients(), which refuses anything a person has not confirmed
 * (PV010), so this cannot send early even if the caller is wrong. Each person gets a fresh personal link. Nothing here logs an address,
 * a name or a link: log lines carry counts and error codes only.
 */
export async function sendMailing(id: string, deps: SendDeps): Promise<SendReport> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const now = deps.now ?? Date.now;
  const started = now();
  const m = await deps.mailing(id);
  if (!m) return { sent: 0, failed: 0, left: 0, stopped: "That mailing was not found." };
  const { data, error } = await deps.rpc("alignment_mailing_recipients", { p_mailing: id });
  if (error) {
    log(JSON.stringify({ alignment: "mailing", code: error.code ?? "unknown" }));
    return { sent: 0, failed: 0, left: 0, stopped: error.code === "PV010" ? "This mailing has not been confirmed by a person." : error.code === "22023" ? error.message.slice(0, 120) : "We could not start sending." };
  }
  const people = (data ?? []) as { id: string; email: string; name: string | null }[];
  let sent = 0, failed = 0, i = 0;
  let stopped: string | undefined;
  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const p = people[i++];
      if (!p) return;
      if (now() - started > (deps.budgetMs ?? 40_000)) { i--; stopped = "Time ran out; press Continue sending for the rest."; return; }
      const token = generateInviteToken();
      const issued = await deps.rpc("alignment_mailing_issue", { p_mailing: id, p_participant: p.id, p_token_hash: hashInviteToken(token) });
      if (issued.error) { log(JSON.stringify({ alignment: "issue", code: issued.error.code ?? "unknown" })); failed++; continue; }
      const mail = buildParticipantEmail(m, { name: p.name, session: m.sessionName, closesAt: m.closesAt, link: `${deps.site}/a/${token}`, unsubscribe: `${deps.site}/a/${token}/unsubscribe` });
      const res = await deps.send({ to: p.email, ...mail });
      const rec = await deps.rpc("alignment_mailing_result", { p_mailing: id, p_participant: p.id, p_ok: res.ok, p_provider: res.ok ? res.id : null, p_error: res.ok ? null : res.error });
      if (rec.error) log(JSON.stringify({ alignment: "result", code: rec.error.code ?? "unknown" }));
      if (res.ok) sent++;
      else {
        failed++;
        if (/rate limiting|not set up|refused the key/.test(res.error)) stopped = res.error;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { sent, failed, left: Math.max(people.length - sent - failed, 0), ...(stopped ? { stopped } : {}) };
}
