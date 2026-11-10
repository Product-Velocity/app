"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { finalResults } from "@/lib/alignment-results";
import { planApply } from "@/lib/alignment-rank";
import { loadSuggestion } from "@/lib/alignment-rank-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies the vote of a closed session to the Stack Rank (issues #394 and #397), for the initiatives the admin ticked, in the order the admin chose
 * (the vote's own order unless changed), with a reason for each initiative whose rank differs from the vote. The moves are worked out here from the
 * stored vote, today's ranks and the chosen order, never taken from the browser; the database checks again that nothing moved since the preview (PV025) and that the
 * person is an admin and not Claude or a service account (PV004). Only Stack Rank and Previous Rank change.
 */
export async function applyVote(form: FormData): Promise<void> {
  const session = String(form.get("session"));
  if (!UUID.test(session)) redirect("/alignment");
  const base = `/alignment/${session}/results`;
  const { supabase, active } = await requireWorkspace(base);
  if (active.role !== "admin") redirect(`${base}?status=not-allowed`);
  const { data: s } = await supabase.from("alignment_sessions").select("id, status").eq("tenant_id", active.tenantId).eq("id", session).maybeSingle();
  if (!s || (s.status !== "closed" && s.status !== "archived")) redirect(`${base}?status=not-allowed`);
  const snap = await finalResults(session);
  if (!snap) redirect(`${base}?status=failed`);
  const selected = form.getAll("item").map(String).filter((x) => UUID.test(x));
  let seen: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(form.get("seen") ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object") seen = parsed as Record<string, number>;
  } catch { /* an unreadable value counts as "not seen": the plan then asks again */ }
  // the final order the person chose (the vote's own when none is sent) and a reason for every initiative that differs from the vote (issue #397)
  const orderSent = form.getAll("order").map(String).filter((x) => UUID.test(x));
  const reasons: Record<string, string> = {};
  for (const id of selected) reasons[id] = String(form.get(`reason_${id}`) ?? "");
  const { rows } = await loadSuggestion(supabase, active.tenantId, session, snap);
  const plan = planApply(rows, selected, seen, orderSent.length > 0 ? orderSent : undefined, reasons);
  if (!plan.ok) redirect(`${base}?status=${plan.reason}`);
  const { error } = await supabase.rpc("alignment_rank_apply", {
    p_session: session,
    p_moves: plan.moves.map((m) => ({ item: m.id, from: m.from, to: m.to, ...(plan.reasons[m.id] ? { reason: plan.reasons[m.id] } : {}) })),
    p_scope: plan.scope,
  });
  revalidatePath(base);
  revalidatePath("/portfolio");
  if (error) redirect(`${base}?status=${error.code === "PV025" ? "stale" : error.code === "PV026" ? "reason-needed" : error.code === "PV004" || error.code === "42501" ? "not-allowed" : "failed"}`);
  redirect(`${base}?status=applied`);
}

/** Puts the order back as it was before an application, if nothing has moved since (the database checks). */
export async function undoVote(form: FormData): Promise<void> {
  const session = String(form.get("session")), application = String(form.get("application"));
  if (!UUID.test(session) || !UUID.test(application)) redirect("/alignment");
  const base = `/alignment/${session}/results`;
  const { supabase, active } = await requireWorkspace(base);
  if (active.role !== "admin") redirect(`${base}?status=not-allowed`);
  const { error } = await supabase.rpc("alignment_rank_undo", { p_application: application });
  revalidatePath(base);
  revalidatePath("/portfolio");
  if (error) redirect(`${base}?status=${error.code === "PV025" ? "cannot-undo" : error.code === "PV004" || error.code === "42501" ? "not-allowed" : "failed"}`);
  redirect(`${base}?status=undone`);
}
