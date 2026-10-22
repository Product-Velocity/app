export type RankItem = { id: string; stack_rank: number; home_project_id: string };

/** Order inside each project (1 = first by global rank), for the "In project" column. */
export function projectRanks(items: RankItem[]): Map<string, number> {
  const out = new Map<string, number>();
  const count = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.stack_rank - b.stack_rank)) {
    const n = (count.get(it.home_project_id) ?? 0) + 1;
    count.set(it.home_project_id, n);
    out.set(it.id, n);
  }
  return out;
}

/** The same result as move_item() in the database, so the grid can show it before the save returns. */
export function applyMove<T extends RankItem>(items: T[], id: string, to: number): { items: T[]; from: number; to: number; changed: boolean } {
  const sorted = [...items].sort((a, b) => a.stack_rank - b.stack_rank).map((x) => ({ ...x }));
  const moved = sorted.find((x) => x.id === id);
  if (!moved) return { items: sorted, from: 0, to: 0, changed: false };
  const from = moved.stack_rank;
  const max = sorted.reduce((m, x) => Math.max(m, x.stack_rank), 0);
  const target = Math.max(1, Math.min(Math.round(Number.isFinite(to) ? to : 1), max));
  if (target === from) return { items: sorted, from, to: target, changed: false };
  for (const x of sorted) {
    if (x.id === id) continue;
    if (target < from && x.stack_rank >= target && x.stack_rank < from) x.stack_rank += 1;
    else if (target > from && x.stack_rank > from && x.stack_rank <= target) x.stack_rank -= 1;
  }
  moved.stack_rank = target;
  sorted.sort((a, b) => a.stack_rank - b.stack_rank);
  return { items: sorted, from, to: target, changed: true };
}
