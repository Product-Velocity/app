"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  answersFor, coinsLeft, duelKey, duelPairs, duelsDone, ICE_DEFAULT, pickCount, rankingFromDuels, setCoins,
  type BallotItem, type Method, type Progress,
} from "@/lib/alignment-ballot";
import { saveBallotProgress, submitBallot } from "./actions";

export type BallotApi = {
  save: (token: string, progress: unknown, revision: number) => Promise<{ ok: boolean; revision?: number }>;
  submit: (token: string, answers: unknown, revision: number) => Promise<{ ok: boolean; error?: string }>;
};
type Props = {
  /** The server actions by default; the test page passes its own. */
  api?: BallotApi;
  token: string; method: Method; items: BallotItem[]; coinsTotal: number; coinsMax: number;
  initial: Progress; initialRevision: number; submitted: boolean; closesAt: string | null;
};

function ItemCard({ item, children, selected }: { item: BallotItem; children?: React.ReactNode; selected?: boolean }) {
  return (
    <div className={selected ? "ballot-card selected" : "ballot-card"}>
      <strong>{item.name}</strong>
      {item.summary && <p>{item.summary}</p>}
      {item.value && <p className="muted">{item.value}</p>}
      {children}
    </div>
  );
}

/**
 * The participant's ballot for all three methods, built for a 390 px phone: one decision per screen, large tap targets, progress saved after
 * every change (a newer save always wins, so a reload or a slow network never loses or doubles an answer), and a vote that can be changed
 * until the session closes.
 */
export function Ballot({ api = { save: saveBallotProgress, submit: submitBallot }, token, method, items, coinsTotal, coinsMax, initial, initialRevision, submitted, closesAt }: Props) {
  const [p, setP] = useState<Progress>(initial);
  const [done, setDone] = useState(submitted);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(initialRevision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(p);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const flush = useCallback(async () => {
    const rev = revision.current;
    const r = await api.save(token, latest.current, rev).catch(() => ({ ok: false as const }));
    setSaveNote(r.ok ? "Saved" : "Not saved yet. We will try again when you continue.");
  }, [token, api]);

  const change = (next: Progress) => {
    latest.current = next;
    revision.current += 1;
    setP(next);
    setError(null);
    setSaveNote(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const result = answersFor(method, items, p, { coinsTotal });
  const send = async () => {
    if (!result.ok || pending) return;
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    const r = await api.submit(token, result.answers, revision.current + 1).catch(() => ({ ok: false as const, error: "We could not reach the server. Check your connection and press the button again." }));
    setPending(false);
    if (r.ok) { revision.current += 1; setDone(true); } else setError(r.error ?? "We could not save your vote.");
  };

  const when = closesAt ? ` until ${new Date(closesAt).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "";
  if (done) {
    return (
      <div className="stack ballot" aria-live="polite">
        <p role="status" className="notice"><strong>Thank you. Your vote is saved.</strong></p>
        <p className="muted">You can change your vote{when || " until the session closes"}. Open your personal link again to do so.</p>
        <div><button type="button" className="btn" onClick={() => setDone(false)}>Change my vote</button></div>
      </div>
    );
  }

  const status = <p className="muted ballot-save" role="status" aria-live="polite">{saveNote ?? ""}</p>;
  const submitRow = (
    <div className="stack">
      {!result.ok && <p className="muted">{result.reason}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div><button type="button" className="btn btn-primary ballot-big" disabled={!result.ok || pending} onClick={send}>{pending ? "Saving…" : "Submit my vote"}</button></div>
      {status}
    </div>
  );

  if (method === "coins") {
    const left = coinsLeft(p.coins, coinsTotal);
    return (
      <div className="stack ballot">
        <div className="ballot-sticky" role="status" aria-live="polite"><strong>{left}</strong> of {coinsTotal} coins left · at most {coinsMax} on one</div>
        {items.map((i) => {
          const n = p.coins?.[i.id] ?? 0;
          const set = (v: number) => change({ ...p, coins: setCoins(p.coins, i.id, v, coinsTotal, coinsMax) });
          return (
            <ItemCard key={i.id} item={i}>
              <div className="ballot-stepper" role="group" aria-label={`Coins for ${i.name}`}>
                <button type="button" className="btn ballot-big" aria-label={`Fewer coins for ${i.name}`} onClick={() => set(n - 5)} disabled={n <= 0}>−5</button>
                <input type="number" inputMode="numeric" min={0} max={coinsMax} value={n} aria-label={`Coins for ${i.name}`} onChange={(e) => set(Number(e.target.value))} />
                <button type="button" className="btn ballot-big" aria-label={`More coins for ${i.name}`} onClick={() => set(n + 5)} disabled={n >= coinsMax || left <= 0}>+5</button>
              </div>
            </ItemCard>
          );
        })}
        {submitRow}
      </div>
    );
  }

  if (method === "ice") {
    return (
      <div className="stack ballot">
        <p className="muted">Score each initiative from 1 (low) to 10 (high). {items.filter((i) => p.ice?.[i.id]).length} of {items.length} scored.</p>
        {items.map((i) => {
          const v = p.ice?.[i.id] ?? ICE_DEFAULT;
          const set = (k: "impact" | "confidence" | "ease", n: number) => change({ ...p, ice: { ...(p.ice ?? {}), [i.id]: { ...v, [k]: n } } });
          return (
            <ItemCard key={i.id} item={i} selected={!!p.ice?.[i.id]}>
              {(["impact", "confidence", "ease"] as const).map((k) => (
                <label key={k} className="ballot-slider">
                  <span>{k[0]!.toUpperCase() + k.slice(1)}: <strong>{v[k]}</strong></span>
                  <input type="range" min={1} max={10} step={1} value={v[k]} aria-label={`${k} of ${i.name}`} onChange={(e) => set(k, Number(e.target.value))} />
                </label>
              ))}
              <p className="muted">{p.ice?.[i.id] ? "Scored" : "Not scored yet: move a slider to score it"}</p>
            </ItemCard>
          );
        })}
        {submitRow}
      </div>
    );
  }

  // top 5, then duels
  const k = pickCount(items.length);
  const picks = p.picks ?? [];
  const step = p.step ?? "pick";
  if (step === "pick") {
    const toggle = (id: string) => change({ ...p, picks: picks.includes(id) ? picks.filter((x) => x !== id) : picks.length < k ? [...picks, id] : picks });
    return (
      <div className="stack ballot">
        <div className="ballot-sticky" role="status" aria-live="polite"><strong>{picks.length}</strong> of {k} picked</div>
        <p className="muted">Pick the {k} initiatives that matter most.</p>
        {items.map((i) => (
          <ItemCard key={i.id} item={i} selected={picks.includes(i.id)}>
            <button type="button" className={picks.includes(i.id) ? "btn btn-primary ballot-big" : "btn ballot-big"} aria-pressed={picks.includes(i.id)} onClick={() => toggle(i.id)} disabled={!picks.includes(i.id) && picks.length >= k}>
              {picks.includes(i.id) ? "Picked" : "Pick"}<span className="sr-only"> {i.name}</span>
            </button>
          </ItemCard>
        ))}
        <div><button type="button" className="btn btn-primary ballot-big" disabled={picks.length !== k} onClick={() => change({ ...p, step: "duels" })}>Next: duels</button></div>
        {status}
      </div>
    );
  }
  const pairs = duelPairs(picks);
  const duels = p.duels ?? {};
  const next = pairs.findIndex(([a, b]) => !duels[duelKey(a, b)]);
  if (step === "duels" && next !== -1) {
    const [a, b] = pairs[next]!;
    const choose = (w: string) => change({ ...p, duels: { ...duels, [duelKey(a, b)]: w } });
    return (
      <div className="stack ballot">
        <div className="ballot-sticky" role="status" aria-live="polite">Duel <strong>{next + 1}</strong> of {pairs.length}</div>
        <p className="muted">Which matters more?</p>
        {[a, b].map((id) => (
          <ItemCard key={id} item={byId.get(id)!}>
            <button type="button" className="btn btn-primary ballot-big" onClick={() => choose(id)}>This one<span className="sr-only"> matters more: {byId.get(id)!.name}</span></button>
          </ItemCard>
        ))}
        <div className="row-form">
          {next > 0 && <button type="button" className="btn" onClick={() => { const [pa, pb] = pairs[next - 1]!; const d = { ...duels }; delete d[duelKey(pa, pb)]; change({ ...p, duels: d }); }}>Back one duel</button>}
          <button type="button" className="btn" onClick={() => change({ ...p, step: "pick" })}>Change my picks</button>
        </div>
        {status}
      </div>
    );
  }
  const order = rankingFromDuels(picks, duels);
  return (
    <div className="stack ballot">
      <p className="muted">This is your order, from the duels. Submit it, or go back and change a duel.</p>
      <ol className="plain-list">{order.map((id) => <li key={id}><strong>{byId.get(id)?.name}</strong></li>)}</ol>
      {duelsDone(picks, duels) && submitRow}
      <div><button type="button" className="btn" onClick={() => { const d = { ...duels }; const [la, lb] = pairs[pairs.length - 1]!; delete d[duelKey(la, lb)]; change({ ...p, duels: d, step: "duels" }); }}>Back to the duels</button></div>
    </div>
  );
}
