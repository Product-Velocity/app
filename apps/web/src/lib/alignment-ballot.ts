/** Pure rules of the participant ballot (issue #125): what is asked, what counts as complete, and how duels become an order. */

export type BallotItem = { id: string; name: string; summary: string | null; value: string | null };
export type Method = "top5_duels" | "coins" | "ice";
export type Ice = { impact: number; confidence: number; ease: number };

/** Saved progress of a ballot. Only the fields of the session's method are used. */
export type Progress = {
  picks?: string[];
  /** duel key "a|b" (a before b in the pick order) -> the winner's id */
  duels?: Record<string, string>;
  step?: "pick" | "duels" | "review";
  coins?: Record<string, number>;
  ice?: Record<string, Ice>;
};

/** How many initiatives a person picks for the top list: five, or all of them when there are fewer. */
export const pickCount = (n: number) => Math.min(5, n);

/** Every pair among the picks, in a fixed order, as [a, b] with a picked before b. Five picks give ten duels. */
export function duelPairs(picks: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) out.push([picks[i]!, picks[j]!]);
  return out;
}
export const duelKey = (a: string, b: string) => `${a}|${b}`;

export const duelsDone = (picks: string[], duels: Record<string, string>) => duelPairs(picks).every(([a, b]) => duels[duelKey(a, b)] === a || duels[duelKey(a, b)] === b);

/** The person's order: most duels won first; equal wins keep the order they were picked in. */
export function rankingFromDuels(picks: string[], duels: Record<string, string>): string[] {
  const wins = new Map(picks.map((p) => [p, 0]));
  for (const [a, b] of duelPairs(picks)) {
    const w = duels[duelKey(a, b)];
    if (w === a || w === b) wins.set(w, (wins.get(w) ?? 0) + 1);
  }
  return [...picks].sort((x, y) => (wins.get(y)! - wins.get(x)!) || picks.indexOf(x) - picks.indexOf(y));
}

export const coinsSpent = (coins: Record<string, number> | undefined) => Object.values(coins ?? {}).reduce((n, c) => n + (Number.isFinite(c) ? c : 0), 0);
export const coinsLeft = (coins: Record<string, number> | undefined, total: number) => total - coinsSpent(coins);

/** Sets coins on one initiative, never above the per-item maximum, never below zero and never beyond what is left. */
export function setCoins(coins: Record<string, number> | undefined, id: string, want: number, total: number, max: number): Record<string, number> {
  const rest = coinsSpent(coins) - (coins?.[id] ?? 0);
  const n = Math.max(0, Math.min(Math.floor(Number.isFinite(want) ? want : 0), max, total - rest));
  return { ...(coins ?? {}), [id]: n };
}

export const ICE_DEFAULT: Ice = { impact: 5, confidence: 5, ease: 5 };

/** The answers to send, or the reason the ballot is not complete yet (a short sentence for the person). */
export function answersFor(method: Method, items: BallotItem[], p: Progress, s: { coinsTotal: number }): { ok: true; answers: Record<string, unknown> } | { ok: false; reason: string } {
  const ids = new Set(items.map((i) => i.id));
  if (method === "top5_duels") {
    const k = pickCount(items.length);
    const picks = (p.picks ?? []).filter((x) => ids.has(x));
    if (picks.length !== k) return { ok: false, reason: `Pick ${k} initiatives.` };
    if (!duelsDone(picks, p.duels ?? {})) return { ok: false, reason: "Finish the duels." };
    return { ok: true, answers: { ranking: rankingFromDuels(picks, p.duels ?? {}) } };
  }
  if (method === "coins") {
    const left = coinsLeft(p.coins, s.coinsTotal);
    if (left !== 0) return { ok: false, reason: left > 0 ? `Spend your last ${left} coins.` : "You spent too many coins." };
    return { ok: true, answers: { coins: Object.fromEntries(items.map((i) => [i.id, p.coins?.[i.id] ?? 0])) } };
  }
  const missing = items.filter((i) => !p.ice?.[i.id]).length;
  if (missing > 0) return { ok: false, reason: `Score ${missing} more ${missing === 1 ? "initiative" : "initiatives"}.` };
  return { ok: true, answers: { ice: Object.fromEntries(items.map((i) => [i.id, p.ice![i.id]])) } };
}

/** Keeps a saved progress usable when the session's items changed or the data is damaged. */
export function cleanProgress(raw: unknown, items: BallotItem[]): Progress {
  const ids = new Set(items.map((i) => i.id));
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Progress = {};
  if (Array.isArray(r.picks)) out.picks = [...new Set(r.picks.filter((x): x is string => typeof x === "string" && ids.has(x)))].slice(0, 5);
  if (r.duels && typeof r.duels === "object") {
    out.duels = Object.fromEntries(Object.entries(r.duels as Record<string, unknown>).filter(([k, v]) => typeof v === "string" && k.split("|").every((x) => ids.has(x)) && k.split("|").includes(v as string))) as Record<string, string>;
  }
  if (r.step === "pick" || r.step === "duels" || r.step === "review") out.step = r.step;
  if (r.coins && typeof r.coins === "object") out.coins = Object.fromEntries(Object.entries(r.coins as Record<string, unknown>).filter(([k, v]) => ids.has(k) && typeof v === "number" && v >= 0).map(([k, v]) => [k, v as number]));
  if (r.ice && typeof r.ice === "object") {
    const ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10;
    out.ice = Object.fromEntries(Object.entries(r.ice as Record<string, Ice>).filter(([k, v]) => ids.has(k) && v && ok(v.impact) && ok(v.confidence) && ok(v.ease)));
  }
  return out;
}
