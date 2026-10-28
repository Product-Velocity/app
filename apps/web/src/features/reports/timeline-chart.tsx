"use client";

import { useMemo, useState } from "react";
import { lifecycleSegments, type ReportRow } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE } from "./echart";

const DAY_MS = 86_400_000;
const PAGE = 30;
const PHASES = ["Discover", "Define", "Build", "Beta-test", "Experiment", "Roll-out", "Completed", "Sunset", "Not set"];
const HEALTH = ["On Track", "At Risk", "Delayed", "Blocked", "Not set"];
const HEALTH_COLOURS: Record<string, string> = { "On Track": "#0f8a6a", "At Risk": "#c27a00", Delayed: "#b4472f", Blocked: "#8a1f1f", "Not set": "#9aa3b2" };
const phaseColour = (p: string) => PALETTE[Math.max(0, PHASES.indexOf(p)) % PALETTE.length]!;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

type Item = { row: ReportRow; name: string; code: string; segments: NonNullable<ReturnType<typeof lifecycleSegments>> };
type Props = { rows: readonly ReportRow[]; today: Date; onOpen: (id: string) => void };

/** Module 6: one line per initiative with a bar per phase (or one bar from Planned Start to G2M Date (est)), by month or quarter, coloured by Phase or Health. */
export function TimelineChart({ rows, today, onOpen }: Props) {
  const [zoom, setZoom] = useState<"month" | "quarter">("month");
  const [colourBy, setColourBy] = useState<"phase" | "health">("phase");
  const [shown, setShown] = useState(PAGE);
  const items = useMemo<Item[]>(() => rows.flatMap((row) => {
    const segments = lifecycleSegments(row, today);
    return segments ? [{ row, segments, name: String(row.initiative_name ?? ""), code: String(row.item_code ?? "") }] : [];
  }), [rows, today]);
  const visible = useMemo(() => items.slice(0, shown), [items, shown]);
  const unscheduled = rows.length - items.length;
  const legend = colourBy === "phase" ? PHASES.filter((p) => items.some((i) => i.segments.some((s) => s.phase === p))) : HEALTH.filter((h) => items.some((i) => (String(i.row.health ?? "") || "Not set") === h));
  const colourOf = (item: Item, phase: string) => (colourBy === "phase" ? phaseColour(phase) : HEALTH_COLOURS[String(item.row.health ?? "") || "Not set"] ?? "#9aa3b2");
  const wordOf = (item: Item, phase: string) => (colourBy === "phase" ? phase : String(item.row.health ?? "") || "Not set");

  const option = useMemo<EChartsCoreOption>(() => {
    const data = visible.flatMap((item, line) => item.segments.map((s) => ({ value: [line, ms(s.start), ms(s.end), wordOf(item, s.phase), item.row.id, colourOf(item, s.phase), s.phase] })));
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 56, containLabel: true },
      tooltip: { textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const v = (p as { value: [number, number, number, string, string, string, string] }).value; const it = visible[v[0]]!; return `<b>${it.code} ${it.name}</b><br/>${v[6]}: ${new Date(v[1]).toISOString().slice(0, 10)} to ${new Date(v[2]).toISOString().slice(0, 10)}${colourBy === "health" ? `<br/>Health: ${v[3]}` : ""}`; } },
      dataZoom: [{ type: "slider", xAxisIndex: 0, bottom: 8, height: 18, filterMode: "weakFilter" }, { type: "inside", xAxisIndex: 0, filterMode: "weakFilter" }],
      xAxis: { type: "time", minInterval: (zoom === "month" ? 28 : 89) * DAY_MS, axisLabel: { color: "#4b5563", hideOverlap: true }, splitLine: { show: true, lineStyle: { color: "#edeff3" } } },
      yAxis: { type: "category", inverse: true, data: visible.map((i) => `${i.code} ${i.name.length > 28 ? `${i.name.slice(0, 27)}…` : i.name}`), axisLabel: { color: "#111827", width: 190, overflow: "truncate" }, axisTick: { show: false }, splitLine: { show: false } },
      series: [{
        type: "custom", clip: true, data,
        encode: { x: [1, 2], y: 0 },
        renderItem: (_: unknown, api: { value: (i: number) => number | string; coord: (v: [number, number]) => [number, number]; size: (v: [number, number]) => [number, number] }) => {
          const line = api.value(0) as number;
          const a = api.coord([api.value(1) as number, line]);
          const b = api.coord([api.value(2) as number, line]);
          const h = api.size([0, 1])[1] * 0.6;
          const w = Math.max(b[0] - a[0], 3);
          return { type: "group", children: [
            { type: "rect", shape: { x: a[0], y: a[1] - h / 2, width: w, height: h, r: 5 }, style: { fill: api.value(5) as string, stroke: "#fff", lineWidth: 1 } },
            ...(w > 64 ? [{ type: "text", style: { text: api.value(3) as string, x: a[0] + 6, y: a[1], fill: "#fff", fontSize: 11, fontFamily: CHART_FONT, textVerticalAlign: "middle" } }] : []),
          ] };
        },
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#111827", type: "dashed" }, label: { formatter: "Today", color: "#111827" }, data: [{ xAxis: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) }] },
      }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, zoom, colourBy, today]);

  return (
    <section className="rp-card rp-wide" aria-label="Timeline">
      <h2 className="rp-title">Timeline</h2>
      <p className="rp-note">Each bar is a phase, from its start date to the next one (the last to G2M Date (actual), else (est), else today). Initiatives with no phase dates use Planned Start to G2M Date (est).</p>
      <div className="rp-bar-tools">
        <div role="group" aria-label="Scale" className="seg-group">
          {(["month", "quarter"] as const).map((z) => <button key={z} type="button" className="tool-btn" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z === "month" ? "Months" : "Quarters"}</button>)}
        </div>
        <div role="group" aria-label="Colour by" className="seg-group">
          {(["phase", "health"] as const).map((c) => <button key={c} type="button" className="tool-btn" aria-pressed={colourBy === c} onClick={() => setColourBy(c)}>Colour by {c === "phase" ? "Phase" : "Health"}</button>)}
        </div>
      </div>
      {items.length === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
        <>
          <ul className="rp-legend" aria-label="Colours">
            {legend.map((l) => <li key={l} className="rp-legend-item"><span className="rp-swatch" style={{ background: colourBy === "phase" ? phaseColour(l) : HEALTH_COLOURS[l] }} aria-hidden="true" />{l}</li>)}
          </ul>
          <EChart name="timeline" label="Timeline of initiative phases" height={visible.length * 26 + 90} option={option} onClick={(p) => { const v = (p.value as unknown[] | undefined); if (v) onOpen(String(v[4])); }} />
          <p className="rp-note">Showing {visible.length} of {items.length} initiatives with dates{unscheduled > 0 ? `; ${unscheduled} without dates are not drawn` : ""}.{" "}
            {items.length > shown && <button type="button" className="link-button" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, items.length - shown)} more</button>}</p>
          <details className="rp-details">
            <summary>Show as table</summary>
            <table className="rp-table" aria-label="Timeline of initiative phases">
              <thead><tr><th scope="col">Initiative</th><th scope="col">Phase</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
              <tbody>{visible.flatMap((i) => i.segments.map((s, k) => (
                <tr key={`${i.row.id}${k}`}><td><button type="button" className="link-button" onClick={() => onOpen(i.row.id)}>{i.code} {i.name}</button></td><td>{s.phase}</td><td>{s.start}</td><td>{s.end}</td></tr>
              )))}</tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
