import type { ReceivedLine, SyncChoice, SyncConfirmResult, SyncPreviewResult } from "@/lib/github/push-types";

// A thin router on top of the trackers' own sync engines (issue #67, Ashu's suggestion). Each tracker keeps its own full sync
// (GitHub's is untouched; Jira gets a dedicated one); this layer only decides, per initiative, which engine handles it, by the
// tracker of the initiative's project, and puts the answers back together. No lowest-common-denominator contract in between.

export type TrackerId = "github" | "jira" | "gitlab";
export type BoardResult = { ok: true; lines: Record<string, ReceivedLine>; failed: boolean } | { ok: false; error: string };

/** What the Sync dialog needs from an engine: check, read the board, confirm. */
export type SyncApi = {
  start(ids: string[], opts?: { board?: boolean }): Promise<SyncPreviewResult>;
  board(ids: string[]): Promise<BoardResult>;
  confirm(ids: string[], choices: SyncChoice[]): Promise<SyncConfirmResult>;
};
export type SyncEngines = Partial<Record<TrackerId, SyncApi>>;
/** The tracker of each initiative's project; null when the project has none yet (it then behaves as GitHub, as before). */
export type TrackerOf = (ids: string[]) => Promise<Map<string, TrackerId | null>>;

const NAME: Record<TrackerId, string> = { github: "GitHub", jira: "Jira", gitlab: "GitLab" };

type Group = { tracker: TrackerId; ids: string[] };
async function groups(ids: string[], trackerOf: TrackerOf): Promise<Group[]> {
  const of = await trackerOf(ids);
  const out = new Map<TrackerId, string[]>();
  for (const id of ids) {
    const t = of.get(id) ?? "github";
    out.set(t, [...(out.get(t) ?? []), id]);
  }
  return [...out].map(([tracker, list]) => ({ tracker, ids: list }));
}
const missing = (t: TrackerId) => ({ ok: false as const, error: `Syncing with ${NAME[t]} is not available yet.` });
/** The groups, or the error for the first tracker without an engine: checked before any engine is called, so nothing is written for the others. */
async function plan(ids: string[], engines: SyncEngines, trackerOf: TrackerOf): Promise<{ parts: (Group & { engine: SyncApi })[] } | { error: ReturnType<typeof missing> }> {
  const parts = await groups(ids, trackerOf);
  const gone = parts.find((g) => !engines[g.tracker]);
  return gone ? { error: missing(gone.tracker) } : { parts: parts.map((g) => ({ ...g, engine: engines[g.tracker]! })) };
}
const rankOf = (ids: string[]) => { const r = new Map(ids.map((id, i) => [id, i])); return <T extends { id: string }>(a: T, b: T) => (r.get(a.id) ?? 0) - (r.get(b.id) ?? 0); };

/** One SyncApi that sends each initiative to its project's engine. With every initiative on one tracker it is that engine, called once with the same arguments. */
export function routeSync(engines: SyncEngines, trackerOf: TrackerOf): SyncApi {
  return {
    async start(ids, opts) {
      const p = await plan(ids, engines, trackerOf);
      if ("error" in p) return p.error;
      const done: Extract<SyncPreviewResult, { ok: true }>[] = [];
      for (const g of p.parts) {
        const r = await g.engine.start(g.ids, opts);
        if (!r.ok) return r;
        done.push(r);
      }
      if (done.length === 1) return done[0]!;
      const byId = rankOf(ids);
      return { ok: true, account: [...new Set(done.map((d) => d.account))].join(", "), received: done.flatMap((d) => d.received).sort(byId), send: done.flatMap((d) => d.send).sort(byId) };
    },
    async board(ids) {
      const p = await plan(ids, engines, trackerOf);
      if ("error" in p) return p.error;
      const done: Extract<BoardResult, { ok: true }>[] = [];
      for (const g of p.parts) {
        const r = await g.engine.board(g.ids);
        if (!r.ok) return r;
        done.push(r);
      }
      if (done.length === 1) return done[0]!;
      return { ok: true, lines: Object.assign({}, ...done.map((d) => d.lines)), failed: done.some((d) => d.failed) };
    },
    async confirm(ids, choices) {
      const p = await plan(ids, engines, trackerOf);
      if ("error" in p) return p.error;
      const done: Extract<SyncConfirmResult, { ok: true }>[] = [];
      for (const g of p.parts) {
        const own = new Set(g.ids);
        const r = await g.engine.confirm(g.ids, choices.filter((c) => own.has(c.itemId)));
        if (!r.ok) return r;
        done.push(r);
      }
      if (done.length === 1) return done[0]!;
      return { ok: true, results: done.flatMap((d) => d.results), taken: done.flatMap((d) => d.taken) };
    },
  };
}
