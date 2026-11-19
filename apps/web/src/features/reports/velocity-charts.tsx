"use client";

import { useMemo } from "react";
import { MIN_FOR_BOX, STAGES, ZONES, bellCurve, histogram, type StageAverage, type StageGroup, type QuarterPoint } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE } from "./echart";
import { AMBER_TEXT, GREEN_TEXT, GRID_LINE, INK, INK_MUTED, STAGE_COLOURS, ZONE_COLOURS, fmtNum, hatchFill, inUnit, unitShort, type Unit } from "./velocity-format";

type Click = (p: { dataIndex?: number }) => void;
/** A round step for an axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
const niceStep = (raw: number): number => { const m = Math.pow(10, Math.floor(Math.log10(raw))); for (const c of [1, 2, 2.5, 5, 10]) if (c * m >= raw) return c * m; return 10 * m; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---- the bell: bars of how many initiatives took about that long, a smooth curve, the median and the average
export function Bell({ days, unit, median, average }: { days: number[]; unit: Unit; median: number; average: number }) {
  const option = useMemo<EChartsCoreOption | null>(() => {
    const values = days.map((d) => inUnit(d, unit));
    const h = histogram(values);
    if (!h) return null;
    const { bins, width } = h;
    const from = bins[0]!.from, to = bins[bins.length - 1]!.to;
    const curve = bellCurve(values, from, to, width);
    const u = unitShort(unit);
    const label = (v: number) => `${fmtNum(v, unit)} ${u}`;
    const med = inUnit(median, unit), avg = inUnit(average, unit);
    const avgRight = avg >= med;
    return {
      grid: { left: 8, right: 44, top: 36, bottom: 28, containLabel: true },
      tooltip: {
        trigger: "item", textStyle: { fontFamily: CHART_FONT },
        formatter: (p: unknown) => {
          const d = (p as { data?: { value: number[] } }).data?.value;
          if (!d) return "";
          return `<b>${fmtNum(d[0]!, unit)} to ${fmtNum(d[1]!, unit)} ${u}</b><br/>${d[2]} initiative${d[2] === 1 ? "" : "s"}<br/>${esc(ZONES[d[3]!]!)}`;
        },
      },
      xAxis: { type: "value", min: from, max: to, name: unit, nameLocation: "end", axisLabel: { color: INK_MUTED, formatter: (v: number) => fmtNum(v, unit).replace(/\.0$/, "") }, splitLine: { show: false } },
      yAxis: { type: "value", name: "initiatives", nameLocation: "end", axisLabel: { color: INK_MUTED }, splitLine: { lineStyle: { color: GRID_LINE } } },
      series: [
        {
          type: "custom", name: "Initiatives", z: 1,
          data: bins.map((b) => ({ value: [b.from, b.to, b.count, b.zone], itemStyle: { color: ZONE_COLOURS[b.zone] } })),
          renderItem: (_p: unknown, api: { value: (i: number) => number; coord: (p: [number, number]) => [number, number]; style: () => Record<string, unknown> }) => {
            const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), 0]);
            return { type: "rect", shape: { x: a[0] + 1, y: a[1], width: Math.max(1, b[0] - a[0] - 2), height: b[1] - a[1], r: [3, 3, 0, 0] }, style: api.style() };
          },
        },
        {
          type: "line", name: "Bell", z: 3, smooth: true, symbol: "none", silent: true, lineStyle: { color: INK, width: 2, opacity: 0.85 }, data: curve.map((p) => [p.x, p.y]),
          markLine: {
            silent: true, symbol: "none", animation: false,
            data: [
              { xAxis: med, lineStyle: { color: INK, width: 2, type: "solid" }, label: { formatter: `Median ${label(med)}`, position: "end", color: INK, fontWeight: 600, fontFamily: CHART_FONT, align: avgRight ? "right" : "left" } },
              { xAxis: avg, lineStyle: { color: INK, width: 2, type: "dashed" }, label: { formatter: `Average ${label(avg)}`, position: "end", color: INK, fontWeight: 600, fontFamily: CHART_FONT, align: avgRight ? "left" : "right" } },
            ],
          },
        },
      ],
    };
  }, [days, unit, median, average]);
  if (!option) return null;
  return <EChart name="velocity-bell" label={`How many initiatives took each length of time, in ${unit}; median ${fmtNum(inUnit(median, unit), unit)}, average ${fmtNum(inUnit(average, unit), unit)}`} height={300} option={option} />;
}

// ---- one row per group: the middle half as a box, the fastest to the slowest tenth as a line, the median, the average
export type RangeRow = {
  key: string;
  label: string;
  n: number;
  /** All in the unit shown. */
  p10: number; p25: number; median: number; p75: number; p90: number; average: number;
  values: number[];
  /** The words next to the median ("▲ 14% slower") and what to add to the tooltip. */
  note: string;
  /** A second line under the note, such as the size-adjusted comparison. */
  adj?: string;
  tone: "slow" | "fast" | "same" | "none";
  sub?: string;
  tip: string;
};
type Api = { value: (i: number) => number; coord: (p: [number, number]) => [number, number]; size: (p: [number, number]) => [number, number]; getWidth: () => number };

export function RangeChart({ name, label, rows, reference, unit, onPick, wholeDays = false, height }: {
  name: string; label: string; rows: RangeRow[]; reference?: number | null; unit: Unit; onPick?: (key: string) => void; wholeDays?: boolean; height?: number;
}) {
  const u = wholeDays ? "d" : unitShort(unit);
  const option = useMemo<EChartsCoreOption>(() => {
    const num = (v: number) => (wholeDays ? String(Math.round(v)) : fmtNum(v, unit));
    const raw = (Math.max(...rows.map((r) => (r.n >= MIN_FOR_BOX ? r.p90 : Math.max(...r.values, 0))), reference ?? 0) || 1) * 1.04;
    const step = niceStep(raw / 5);
    const max = Math.ceil(raw / step) * step;
    return {
      grid: { left: 8, right: 138, top: 8, bottom: 30, containLabel: true },
      tooltip: { trigger: "item", textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => rows[(p as { dataIndex: number }).dataIndex]?.tip ?? "" },
      xAxis: { type: "value", min: 0, max, interval: step, name: wholeDays ? "days" : unit, nameLocation: "middle", nameGap: 24, nameTextStyle: { color: INK_MUTED }, axisLabel: { color: INK_MUTED }, splitLine: { lineStyle: { color: GRID_LINE } } },
      yAxis: {
        type: "category", inverse: true, data: rows.map((r) => r.label), axisTick: { show: false },
        axisLabel: { formatter: (v: string, i: number) => `{n|${v.length > 22 ? `${v.slice(0, 21)}…` : v}}\n{s|n ${rows[i]?.n ?? 0}}`, rich: { n: { color: INK, fontSize: 12.5, fontFamily: CHART_FONT, lineHeight: 16 }, s: { color: "#6b7280", fontSize: 11, fontFamily: CHART_FONT, lineHeight: 14 } } },
      },
      series: [{
        type: "custom", name: label,
        data: rows.map((_, i) => [i]),
        renderItem: (_p: unknown, api: Api) => {
          const i = api.value(0), r = rows[i]!;
          const x = (v: number) => api.coord([v, i])[0];
          const cy = api.coord([0, i])[1];
          const band = api.size([0, 1])[1];
          // the whole row answers to the mouse (tooltip and click), not only the thin shapes
          const kids: unknown[] = [{ type: "rect", shape: { x: 0, y: cy - band / 2, width: api.getWidth(), height: band }, style: { fill: "rgba(0,0,0,0)" } }];
          const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, lineWidth: number, lineDash?: number[]) => ({ type: "line", shape: { x1, y1, x2, y2 }, style: { stroke, lineWidth, lineDash } });
          if (reference) kids.push(line(x(reference), cy - band / 2 + 3, x(reference), cy + band / 2 - 3, "#c27a00", 1.3, [4, 3]));
          if (r.n >= MIN_FOR_BOX) {
            kids.push(line(x(r.p10), cy, x(r.p90), cy, "#6b7280", 1.5), line(x(r.p10), cy - 6, x(r.p10), cy + 6, "#6b7280", 1.5), line(x(r.p90), cy - 6, x(r.p90), cy + 6, "#6b7280", 1.5));
            kids.push({ type: "rect", shape: { x: x(r.p25), y: cy - 8, width: Math.max(2, x(r.p75) - x(r.p25)), height: 16, r: 3 }, style: { fill: PALETTE[0], opacity: 0.85 } });
            kids.push(line(x(r.median), cy - 11, x(r.median), cy + 11, INK, 2.5));
            const ax = x(r.average);
            kids.push({ type: "polygon", shape: { points: [[ax, cy - 6], [ax + 5, cy], [ax, cy + 6], [ax - 5, cy]] }, style: { fill: "#ffffff", stroke: INK, lineWidth: 1.5 } });
          } else {
            for (const v of r.values) kids.push({ type: "circle", shape: { cx: x(v), cy, r: 4.5 }, style: { fill: "#6b7280", stroke: "#ffffff", lineWidth: 1.5 } });
          }
          const right = api.coord([max, i])[0] + 12;
          const lines = (r.note ? 1 : 0) + (r.adj ? 1 : 0);
          kids.push({ type: "text", style: { x: right, y: cy - (lines === 0 ? 0 : lines === 1 ? 7 : 13), text: `${num(r.median)} ${u}`, fill: INK, font: '500 12.5px "IBM Plex Mono", ui-monospace, monospace', textVerticalAlign: "middle" } });
          if (r.note) kids.push({ type: "text", style: { x: right, y: cy + (r.adj ? 1 : 8), text: r.note, fill: r.tone === "slow" ? AMBER_TEXT : r.tone === "fast" ? GREEN_TEXT : INK_MUTED, font: `11px ${CHART_FONT}`, textVerticalAlign: "middle" } });
          if (r.adj) kids.push({ type: "text", style: { x: right, y: cy + 14, text: r.adj, fill: INK_MUTED, font: `11px ${CHART_FONT}`, textVerticalAlign: "middle" } });
          return { type: "group", children: kids };
        },
      }],
    };
  }, [rows, reference, unit, wholeDays, label, u]);
  return <EChart name={name} label={label} height={height ?? Math.max(120, rows.length * 48 + 40)} option={option} onClick={onPick ? (p: Parameters<Click>[0]) => { const r = rows[p.dataIndex ?? -1]; if (r) onPick(r.key); } : undefined} />;
}

// ---- are we getting faster: the median per quarter, the middle half shaded
export function Trend({ points, unit }: { points: QuarterPoint[]; unit: Unit }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const u = unitShort(unit);
    const f = (d: number) => fmtNum(inUnit(d, unit), unit);
    return {
      grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis", textStyle: { fontFamily: CHART_FONT },
        formatter: (p: unknown) => { const q = points[(p as { dataIndex: number }[])[0]!.dataIndex]!; return `<b>${esc(q.quarter)}</b> (n ${q.n})<br/>Median ${f(q.median)} ${u}<br/>Middle half ${f(q.p25)} to ${f(q.p75)} ${u}`; },
      },
      xAxis: { type: "category", data: points.map((q) => `${q.quarter}\nn ${q.n}`), axisLabel: { color: INK_MUTED, lineHeight: 15 }, boundaryGap: false, axisTick: { show: false } },
      yAxis: { type: "value", name: unit, nameLocation: "end", axisLabel: { color: INK_MUTED }, splitLine: { lineStyle: { color: GRID_LINE } } },
      series: [
        { type: "line", stack: "band", name: "25th percentile", data: points.map((q) => inUnit(q.p25, unit)), symbol: "none", lineStyle: { opacity: 0 }, silent: true },
        { type: "line", stack: "band", name: "Middle half", data: points.map((q) => inUnit(q.p75 - q.p25, unit)), symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: PALETTE[0], opacity: 0.16 }, silent: true },
        {
          type: "line", name: "Median", data: points.map((q) => inUnit(q.median, unit)), symbolSize: 9, itemStyle: { color: PALETTE[0], borderColor: "#fff", borderWidth: 2 }, lineStyle: { color: PALETTE[0], width: 2.4 },
          label: { show: true, position: "top", color: INK, fontWeight: 600, fontFamily: CHART_FONT, formatter: (p: unknown) => fmtNum((p as { value: number }).value, unit) },
        },
      ],
    };
  }, [points, unit]);
  return <EChart name="velocity-trend" label={`Median ${unit} per quarter in which the measure ended`} height={250} option={option} />;
}

// ---- working or waiting: the share of elapsed time
export type Slice = { name: string; value: number; colour: string; hatch?: boolean; tip: string };
export function Donut({ name, label, slices, centre, sub }: { name: string; label: string; slices: Slice[]; centre: string; sub: string }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { trigger: "item", textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const d = (p as { dataIndex: number }).dataIndex; return `<b>${esc(slices[d]!.name)}</b><br/>${esc(slices[d]!.tip)}`; } },
    series: [{
      type: "pie", radius: ["56%", "80%"], center: ["50%", "50%"], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: "#fff", borderWidth: 2 },
      data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.hatch ? hatchFill() : s.colour } })),
    }],
    graphic: [
      { type: "text", left: "center", top: "42%", style: { text: centre, fill: INK, font: '500 22px "IBM Plex Mono", ui-monospace, monospace', textAlign: "center" } },
      { type: "text", left: "center", top: "56%", style: { text: sub, fill: INK_MUTED, font: `11px ${CHART_FONT}`, textAlign: "center" } },
    ],
  }), [slices, centre, sub]);
  return <EChart name={name} label={label} height={190} option={option} />;
}

// ---- where the time goes: the stages stacked, a bar per group
export function Stages({ groups, unit, onPick }: { groups: { key: string; label: string; n: number; stages: StageAverage[]; total: number }[]; unit: Unit; onPick?: (key: string) => void }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const u = unitShort(unit);
    const f = (d: number) => fmtNum(inUnit(d, unit), unit);
    return {
      grid: { left: 8, right: 84, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "item", textStyle: { fontFamily: CHART_FONT },
        formatter: (p: unknown) => { const q = p as { seriesName: string; dataIndex: number; value: number }; return `<b>${esc(groups[q.dataIndex]!.label)}</b><br/>${esc(q.seriesName)}: ${f(q.value)} ${u}`; },
      },
      xAxis: { type: "value", axisLabel: { color: INK_MUTED }, splitLine: { lineStyle: { color: GRID_LINE } }, name: unit, nameLocation: "end" },
      yAxis: {
        type: "category", inverse: true, data: groups.map((g) => g.label), axisTick: { show: false },
        axisLabel: { formatter: (v: string, i: number) => `{n|${v.length > 22 ? `${v.slice(0, 21)}…` : v}}\n{s|n ${groups[i]?.n ?? 0}}`, rich: { n: { color: INK, fontSize: 12.5, fontFamily: CHART_FONT, lineHeight: 16 }, s: { color: "#6b7280", fontSize: 11, fontFamily: CHART_FONT, lineHeight: 14 } } },
      },
      series: [
        ...STAGES.map((s) => ({
          type: "bar" as const, name: s.label, stack: "stages", barMaxWidth: 22, itemStyle: { color: s.kind === "gate" ? hatchFill() : STAGE_COLOURS[s.id] },
          label: { show: true, color: s.kind === "work" ? "#ffffff" : INK, fontSize: 10.5, fontFamily: CHART_FONT, ...(s.kind === "gate" ? { backgroundColor: "rgba(255,255,255,0.85)", padding: [1, 3], borderRadius: 3 } : {}), formatter: (p: unknown) => { const d = (p as { value: number }).value; return inUnit(d, unit) >= (unit === "weeks" ? 1.2 : 8) ? f(d) : ""; } },
          data: groups.map((g) => g.stages.find((a) => a.id === s.id)!.average),
        })),
        { type: "bar" as const, name: "Total", stack: "stages", silent: true, data: groups.map(() => 0), label: { show: true, position: "right" as const, color: INK, fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 12, formatter: (p: unknown) => `${f(groups[(p as { dataIndex: number }).dataIndex]!.total)} ${u}` }, itemStyle: { color: "transparent" } },
      ],
    };
  }, [groups, unit]);
  return <EChart name="velocity-stages" label="Average time in each stage of the journey" height={Math.max(150, groups.length * 44 + 30)} option={option} onClick={onPick ? (p) => { const g = groups[p.dataIndex ?? -1]; if (g) onPick(g.key); } : undefined} />;
}
export type { StageGroup };
