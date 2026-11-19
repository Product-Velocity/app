"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DIM_LABEL, VELOCITY_DIMS, VELOCITY_MEASURES, dayOfDate, hasStretch, parseMeasure, parseVelocityDim, velocityRows, velocitySummary, windowCoverage, type GateRequest, type ReportDim, type VelocityMeasureId,
} from "@pv/domain";
import type { ReportEnv } from "./report-env";
import { AllInitiativesCard, InFlightCard } from "./velocity-lists";
import { BellCard, DecisionsCard, GroupCard, SizeCard, StagesCard, SubPhasesCard, TrendCard, WorkWaitCard } from "./velocity-sections";
import { UNITS, parseUnit, type Unit } from "./velocity-format";

/** The settings of the report live in the address next to the filters, so a view can be shared: m (measure), s=1 (from the previous gate), u=d (days), by (break-down). */
export const VELOCITY_PARAMS = ["m", "s", "u", "by"] as const;
type Settings = { measure: VelocityMeasureId; stretch: boolean; unit: Unit; dim: ReportDim };
const readSettings = (p: URLSearchParams): Settings => ({ measure: parseMeasure(p.get("m")), stretch: p.get("s") === "1", unit: parseUnit(p.get("u")), dim: parseVelocityDim(p.get("by")) });
function writeSettings(s: Settings) {
  const url = new URL(window.location.href);
  for (const k of VELOCITY_PARAMS) url.searchParams.delete(k);
  if (s.measure !== "total") url.searchParams.set("m", s.measure);
  if (s.stretch && hasStretch(s.measure)) url.searchParams.set("s", "1");
  if (s.unit === "days") url.searchParams.set("u", "d");
  if (s.dim !== "team") url.searchParams.set("by", s.dim);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** What each measure needs, in words, for the explanation when too few initiatives have the dates. */
const NEEDS: Record<VelocityMeasureId, string> = {
  total: "It needs a Start Discovery (or Start Date) and a Start Roll-Out date.",
  gate_a: "It needs a Start Discovery (or Start Date) and the Gate A decision, or Start Definition.",
  gate_b: "It needs a Start Discovery (or Start Date) and the Gate B decision, or Start Building.",
  gate_c: "It needs a Start Discovery (or Start Date) and the Gate C decision, or Start Roll-Out.",
  build: "It needs Start Building and the end of the build (a tracker completion or the next phase start).",
};

/**
 * Velocity (issue #545): how long initiatives take from Start Discovery to Start Roll-Out, to each gate and in Build, how it is spread (percentiles, the bell), where the
 * time goes and how long gates take to decide. Follows the filters of the Reports tab. Team level only (rule 8): nothing is shown per person or per approver.
 */
export function VelocityReport({ env, load, onOpen }: { env: ReportEnv; load?: () => Promise<GateRequest[]>; onOpen: (id: string) => void }) {
  const params = useSearchParams();
  const [s, setS] = useState<Settings>(() => readSettings(params));
  useEffect(() => writeSettings(s), [s]);
  const stretch = s.stretch && hasStretch(s.measure);
  const measure = VELOCITY_MEASURES.find((m) => m.id === s.measure)!;

  const [requests, setRequests] = useState<GateRequest[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    if (!load) return;
    load().then((r) => { if (live) { setRequests(r); setFailed(null); } }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : "Could not read the gate requests."); });
    return () => { live = false; };
  }, [load, reload]);

  /** Without a gate source the report still works from the phase dates; the waits are then zero. */
  const gateRequests = useMemo(() => (load ? requests : []) ?? [], [load, requests]);
  const today = dayOfDate(env.controller.todayDate());
  const vrows = useMemo(() => velocityRows(env.rows, gateRequests, { measure: s.measure, stretch }, today), [env.rows, gateRequests, s.measure, stretch, today]);
  const summary = useMemo(() => velocitySummary(vrows), [vrows]);
  const coverage = useMemo(() => windowCoverage(vrows), [vrows]);
  const settings = useMemo(() => ({ measure: s.measure, stretch }), [s.measure, stretch]);
  const title = `${measure.label}${stretch ? " (previous gate to this gate)" : ""}`;

  if (failed) return <div role="alert" className="error">Could not load the gate dates: {failed} <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>Try again</button></div>;
  if (load && requests === null) return <p role="status" className="muted">Loading the gate dates…</p>;

  const seg = <T extends string>(label: string, items: readonly { id: T; label: string; disabled?: boolean; hint?: string }[], value: T, set: (v: T) => void) => (
    <div className="vel-ctl"><span>{label}</span>
      <div className="vel-seg" role="group" aria-label={label}>{items.map((i) => <button key={i.id} type="button" aria-pressed={value === i.id} disabled={i.disabled} title={i.hint} onClick={() => set(i.id)}>{i.label}</button>)}</div>
    </div>
  );

  return (
    <>
      <section className="vel-bar" aria-label="Velocity settings">
        <div className="vel-row" role="group" aria-label="Velocity settings">
          {seg("Time measured", VELOCITY_MEASURES, s.measure, (measure) => setS((x) => ({ ...x, measure })))}
          {seg("Counted from", [{ id: "start", label: "Start of Discovery" }, { id: "gate", label: "Previous gate", disabled: !hasStretch(s.measure), hint: hasStretch(s.measure) ? undefined : "Only for Gate B and Gate C" }] as const, stretch ? "gate" : "start", (v) => setS((x) => ({ ...x, stretch: v === "gate" })))}
          {seg("Unit", UNITS, s.unit, (unit) => setS((x) => ({ ...x, unit })))}
          {seg("Break down by", VELOCITY_DIMS.map((d) => ({ id: d, label: DIM_LABEL[d] })), s.dim, (dim) => setS((x) => ({ ...x, dim })))}
          <p className="vel-defn"><b>{measure.label}:</b> {stretch && "stretch" in measure ? measure.stretch : measure.description}</p>
        </div>
      </section>

      <BellCard summary={summary} vrows={vrows} unit={s.unit} title={`How long it takes: ${title}`} coverage={coverage} measure={{ label: measure.label, needs: NEEDS[s.measure] }} />

      <div className="vel-grid-2">
        <SizeCard vrows={vrows} unit={s.unit} summary={summary} env={env} />
        <GroupCard vrows={vrows} unit={s.unit} summary={summary} dim={s.dim} env={env} />
      </div>

      <div className="vel-grid-21">
        <TrendCard vrows={vrows} unit={s.unit} />
        <WorkWaitCard vrows={vrows} />
      </div>

      <StagesCard vrows={vrows} unit={s.unit} dim={s.dim} env={env} />

      <div className="vel-sec"><h2>Decisions</h2><p>Time from requesting a gate to the decision, always in days. Follows the filters, not the measure.</p></div>
      <DecisionsCard env={env} requests={gateRequests} today={today} onOpen={onOpen} />

      <div className="vel-sec"><h2>Development sub-phases</h2><p>Build, Test and Experiment on their own. Follows the filters and the unit, not the measure.</p></div>
      <SubPhasesCard vrows={vrows} unit={s.unit} today={today} />

      <div className="vel-sec"><h2>Where to look</h2><p>The initiatives behind the averages.</p></div>
      <InFlightCard env={env} requests={gateRequests} today={today} unit={s.unit} settings={settings} measureLabel={title} onOpen={onOpen} />
      <AllInitiativesCard env={env} vrows={vrows} unit={s.unit} title={title} onOpen={onOpen} />
    </>
  );
}
