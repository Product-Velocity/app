import "server-only";
import { scoreSession, type BallotInput, type Results, type ScoringMethod, type Vote } from "@pv/domain";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** What is stored when a session closes: aggregates only. No name, no address, no group of fewer than 5 voters. */
export type ResultsSnapshot = {
  version: 1;
  computedAt: string;
  method: ScoringMethod;
  items: { id: string; name: string }[];
  voters: number;
  invited: number;
  results: Results;
};

const PAGE = 1000;
async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await read(from, from + PAGE - 1);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Scores the submitted ballots of a session as they are now. Reads votes by ballot and group only, never who they belong to. */
export async function computeResults(admin: Admin, sessionId: string): Promise<ResultsSnapshot | null> {
  const { data: s } = await admin.from("alignment_sessions").select("id, method, weighting, excluded_groups, groups").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const { data: items } = await admin.from("alignment_items").select("id, shown_name, position").eq("session_id", sessionId).order("position");
  const itemList = (items ?? []) as { id: string; shown_name: string | null }[];
  const ballots = await all<{ id: string; group_id: string }>((a, b) => admin.from("alignment_ballots").select("id, group_id").eq("session_id", sessionId).eq("state", "submitted").order("id").range(a, b) as never);
  const votes = await all<{ ballot_id: string; alignment_item_id: string } & Vote>((a, b) => admin.from("alignment_votes").select("ballot_id, alignment_item_id, rank, coins, impact, confidence, ease").eq("session_id", sessionId).order("id").range(a, b) as never);
  const byBallot = new Map<string, Record<string, Vote>>();
  for (const v of votes) {
    const m = byBallot.get(v.ballot_id) ?? {};
    m[v.alignment_item_id] = { rank: v.rank, coins: v.coins, impact: v.impact, confidence: v.confidence, ease: v.ease };
    byBallot.set(v.ballot_id, m);
  }
  const inputs: BallotInput[] = ballots.map((b) => ({ group: b.group_id, votes: byBallot.get(b.id) ?? {} }));
  const { count: invited } = await admin.from("alignment_participants").select("id", { count: "exact", head: true }).eq("session_id", sessionId).not("invited_at", "is", null);
  const results = scoreSession({
    method: s.method as ScoringMethod,
    itemIds: itemList.map((i) => i.id),
    ballots: inputs,
    groups: s.groups as { id: string; name: string }[],
    weighting: s.weighting as "equal" | "headcount",
    excluded: s.excluded_groups as string[],
  });
  return { version: 1, computedAt: new Date().toISOString(), method: s.method as ScoringMethod, items: itemList.map((i) => ({ id: i.id, name: i.shown_name ?? "Initiative" })), voters: inputs.length, invited: invited ?? 0, results };
}

/** The stored results of a closed session; made and stored now if the session closed since the last look. */
export async function finalResults(sessionId: string): Promise<ResultsSnapshot | null> {
  const admin = createAdminClient({ via: "system" });
  const { data: s } = await admin.from("alignment_sessions").select("status, results_snapshot").eq("id", sessionId).maybeSingle();
  if (!s || (s.status !== "closed" && s.status !== "archived")) return null;
  if (s.results_snapshot) return s.results_snapshot as ResultsSnapshot;
  const snap = await computeResults(admin, sessionId);
  if (!snap) return null;
  await admin.rpc("alignment_results_store", { p_session: sessionId, p_snapshot: snap });
  // another request may have stored first: the stored copy is the one that counts
  const { data: again } = await admin.from("alignment_sessions").select("results_snapshot").eq("id", sessionId).maybeSingle();
  return (again?.results_snapshot as ResultsSnapshot | null) ?? snap;
}

/** Stores the results of every closed session that has none yet (daily job). */
export async function finalizeAllClosed(): Promise<number> {
  const admin = createAdminClient({ via: "system" });
  const { data } = await admin.from("alignment_sessions").select("id").in("status", ["closed", "archived"]).is("results_snapshot", null).limit(50);
  let n = 0;
  for (const s of (data ?? []) as { id: string }[]) if (await finalResults(s.id)) n++;
  return n;
}

/** Where the team ranks each initiative today: its place among the session's initiatives by global Stack Rank. */
export async function teamPlaces(sessionId: string): Promise<Map<string, number>> {
  const admin = createAdminClient({ via: "system" });
  const { data: ai } = await admin.from("alignment_items").select("id, item_id").eq("session_id", sessionId);
  const links = ((ai ?? []) as { id: string; item_id: string | null }[]).filter((x) => x.item_id);
  const { data: it } = await admin.from("items").select("id, stack_rank").in("id", links.map((l) => l.item_id!));
  const rank = new Map(((it ?? []) as { id: string; stack_rank: number | null }[]).map((r) => [r.id, r.stack_rank ?? Number.MAX_SAFE_INTEGER]));
  const ordered = links.map((l) => ({ id: l.id, r: rank.get(l.item_id!) ?? Number.MAX_SAFE_INTEGER })).sort((a, b) => a.r - b.r);
  return new Map(ordered.map((o, i) => [o.id, i + 1]));
}
