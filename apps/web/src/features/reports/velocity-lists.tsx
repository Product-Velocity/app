"use client";

import { useMemo, useState } from "react";
import { SIZES, STAGES, inFlightSlow, stageDays, valuesOf, type GateRequest, type StageId, type VelocityRow, type VelocitySettings } from "@pv/domain";
import type { ReportEnv } from "./report-env";
import { STAGE_COLOURS, fmtDays, fmtNum, inUnit, type Unit } from "./velocity-format";

const text = (v: unknown) => (typeof v === "string" ? v : "");
const stageLabel = (id: StageId) => STAGES.find((s) => s.id === id)!.label;
const stageKind = (id: StageId) => STAGES.find((s) => s.id === id)!.kind;

/** The bar of where one initiative's time went: a segment per stage, the same colours as the stage chart, hatched while it waited for a gate decision. */
function MiniBar({ days, scale }: { days: Record<StageId, number>; scale: number }) {
  return (
    <div className="vel-mini" style={{ width: `${Math.max(3, scale)}%` }} role="img" aria-label={STAGES.filter((s) => days[s.id] > 0).map((s) => `${s.label} ${Math.round(days[s.id])} days`).join(", ")}>
      {STAGES.filter((s) => days[s.id] > 0).map((s) => <i key={s.id} className={s.kind === "gate" ? "vel-hatch" : undefined} style={{ flex: days[s.id], background: s.kind === "gate" ? undefined : STAGE_COLOURS[s.id] }} title={`${s.label}: ${Math.round(days[s.id])} days`} />)}
    </div>
  );
}

// ---- in flight and already slower than usual
export function InFlightCard({ env, requests, today, unit, settings, measureLabel, onOpen }: { env: ReportEnv; requests: readonly GateRequest[]; today: number; unit: Unit; settings: VelocitySettings; measureLabel: string; onOpen: (id: string) => void }) {
  const list = useMemo(() => inFlightSlow(env.rows, requests, settings, today), [env.rows, requests, settings, today]);
  return (
    <section className="rp-card rp-wide" aria-label="In flight and already slower than usual">
      <h2 className="rp-title">In flight and already slower than usual ({list.length})</h2>
      <p className="rp-note">For the measure chosen above ({measureLabel}): started it, not at its end yet, and already past the time 80% of the finished initiatives of the same size needed. Needs at least 5 finished initiatives to compare with. Cancelled and completed initiatives are not listed.</p>
      {list.length === 0 ? <p className="rp-empty">Nothing in flight is past its usual time for this measure with these filters.</p> : (
        <div className="rp-table-wrap">
          <table className="rp-table" aria-label="In flight and already slower than usual">
            <thead><tr><th scope="col">Initiative</th><th scope="col">Size</th><th scope="col">Now in</th><th scope="col">Days there</th><th scope="col">Elapsed</th><th scope="col">Against the usual</th></tr></thead>
            <tbody>{list.slice(0, 10).map((x) => {
              const row = env.inScope.find((r) => r.id === x.id);
              return (
                <tr key={x.id}>
                  <td><button type="button" className="link-button" onClick={() => onOpen(x.id)}>{env.nameOf(x.id)}</button> <span className="muted">{text(row?.item_code)}</span></td>
                  <td>{text(row?.effort) || "–"}</td><td>{stageLabel(x.stage)}{stageKind(x.stage) !== "work" ? " (waiting)" : ""}</td><td>{x.daysInStage}</td><td>{fmtDays(x.elapsed, unit)}</td>
                  <td><span className="vel-pill">{fmtDays(x.over, unit)} over</span></td>
                </tr>
              );
            })}</tbody>
          </table>
          {list.length > 10 && <p className="rp-note vel-small">{list.length - 10} more.</p>}
        </div>
      )}
    </section>
  );
}

// ---- every initiative of the filters, with search, filters and sort
type SortId = "slowest" | "fastest" | "team" | "size";
const SORTS: { id: SortId; label: string }[] = [{ id: "slowest", label: "Slowest first" }, { id: "fastest", label: "Fastest first" }, { id: "team", label: "Team" }, { id: "size", label: "Size" }];
type Local = { q: string; size: string; team: string; kr: string; bl: string; group: string; focus: string; stage: string };
const NONE: Local = { q: "", size: "", team: "", kr: "", bl: "", group: "", focus: "", stage: "" };

export function AllInitiativesCard({ env, vrows, unit, title, onOpen }: { env: ReportEnv; vrows: readonly VelocityRow[]; unit: Unit; title: string; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<SortId>("slowest");
  const [f, setF] = useState<Local>(NONE);
  const rows = useMemo(() => vrows.filter((v) => v.value !== null).map((v) => {
    const days = stageDays(v);
    const longest = STAGES.reduce((best, s) => (days[s.id] > days[best.id] ? s : best), STAGES[0]);
    return { v, days, longest: days[longest.id] > 0 ? longest.id : null, teams: valuesOf(v.row, "team", env.ctx) };
  }), [vrows, env.ctx]);
  const options = (pick: (r: (typeof rows)[number]) => string[]) => [...new Set(rows.flatMap(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
  const opt = useMemo(() => ({
    size: SIZES.filter((s) => rows.some((r) => text(r.v.row.effort) === s)) as string[],
    team: options((r) => r.teams), kr: options((r) => [text(r.v.row.kr_metric)]), bl: options((r) => [text(r.v.row.business_line)]), group: options((r) => [text(r.v.row.theme)]), focus: options((r) => [text(r.v.row.focus_area)]),
    stage: STAGES.filter((s) => rows.some((r) => r.longest === s.id)).map((s) => s.label),
  }), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const keep = rows.filter((r) => {
      const row = r.v.row;
      return (!q || text(row.initiative_name).toLowerCase().includes(q) || text(row.item_code).toLowerCase().includes(q))
        && (!f.size || text(row.effort) === f.size) && (!f.team || r.teams.includes(f.team)) && (!f.kr || text(row.kr_metric) === f.kr) && (!f.bl || text(row.business_line) === f.bl)
        && (!f.group || text(row.theme) === f.group) && (!f.focus || text(row.focus_area) === f.focus) && (!f.stage || (r.longest !== null && stageLabel(r.longest) === f.stage));
    });
    const slow = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.v.value! - a.v.value!;
    const order = { slowest: slow, fastest: (a: (typeof rows)[number], b: (typeof rows)[number]) => a.v.value! - b.v.value!, team: (a: (typeof rows)[number], b: (typeof rows)[number]) => (a.teams[0] ?? "~").localeCompare(b.teams[0] ?? "~", "en") || slow(a, b), size: (a: (typeof rows)[number], b: (typeof rows)[number]) => (SIZES.indexOf(text(a.v.row.effort) as never) + 99) % 99 - (SIZES.indexOf(text(b.v.row.effort) as never) + 99) % 99 || slow(a, b) }[sort];
    return keep.sort(order);
  }, [rows, f, sort]);
  const max = Math.max(1, ...shown.map((r) => r.v.value!));
  const set = (k: keyof Local) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const select = (id: keyof Local, label: string, values: string[], all: string) => (
    <label className="vel-f"><span>{label}</span><select id={`vel-f-${id}`} value={f[id]} onChange={set(id)}><option value="">{all}</option>{values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
  );
  return (
    <section className="rp-card rp-wide" aria-label="All initiatives">
      <div className="vel-head-row">
        <div>
          <h2 className="rp-title">All initiatives: {title}</h2>
          <p className="rp-note">Every initiative that reached the end of the measure with the filters above ({rows.length}), with where its time went (the colours of the stage chart). Team and Size sort slowest first within each group.</p>
        </div>
        <div className="vel-seg" role="group" aria-label="Sort by">{SORTS.map((s) => <button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</button>)}</div>
      </div>
      {rows.length === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
        <>
          <div className="vel-tools" role="search" aria-label="Search and filter this list">
            <label className="vel-f vel-f-q"><span>Search</span><input id="vel-f-q" type="search" value={f.q} onChange={set("q")} placeholder="Initiative name or ID" autoComplete="off" /></label>
            {select("size", "Size", opt.size, "All sizes")}{select("team", "Team", opt.team, "All teams")}{select("kr", "Key Result", opt.kr, "All Key Results")}{select("bl", "Business line", opt.bl, "All business lines")}
            {select("group", "Initiative Group", opt.group, "All groups")}{select("focus", "Focus Area", opt.focus, "All focus areas")}{select("stage", "Longest stage", opt.stage, "All stages")}
            <button type="button" className="tool-btn" disabled={JSON.stringify(f) === JSON.stringify(NONE)} onClick={() => setF(NONE)}>Clear</button>
            <span className="muted vel-count" role="status">Showing {shown.length} of {rows.length}</span>
          </div>
          {shown.length === 0 ? <p className="rp-empty" role="status">No initiatives match this search. Clear it to see all {rows.length}.</p> : (
            <div className="rp-table-wrap vel-all">
              <table className="rp-table" aria-label="All initiatives">
                <thead><tr><th scope="col">Initiative</th><th scope="col">Initiative Group</th><th scope="col">Focus Area</th><th scope="col">Size</th><th scope="col">Team</th><th scope="col">Key Result</th><th scope="col">Business line</th><th scope="col">{unit === "weeks" ? "Weeks" : "Days"}</th><th scope="col" className="vel-wide-col">Where the time went</th><th scope="col">Longest stage</th></tr></thead>
                <tbody>{shown.map((r) => {
                  const row = r.v.row;
                  return (
                    <tr key={r.v.id}>
                      <td><button type="button" className="link-button" onClick={() => onOpen(r.v.id)}>{env.nameOf(r.v.id)}</button> <span className="muted">{text(row.item_code)}</span></td>
                      <td>{text(row.theme) || "–"}</td><td>{text(row.focus_area) || "–"}</td><td>{text(row.effort) || "–"}</td><td>{r.teams.map((t) => env.label("team", t)).join(", ")}</td><td>{text(row.kr_metric) || "–"}</td><td>{text(row.business_line) || "–"}</td>
                      <td>{fmtNum(inUnit(r.v.value!, unit), unit)}</td>
                      <td className="vel-wide-col"><MiniBar days={r.days} scale={(r.v.value! / max) * 100} /></td>
                      <td>{r.longest === null ? <span className="muted">–</span> : <>{stageLabel(r.longest)} <span className="muted">{fmtDays(r.days[r.longest], unit)}</span></>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
