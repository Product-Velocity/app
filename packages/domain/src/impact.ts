import { compareValues, UNSET, valuesOf, type ReportRow } from "./reports";

/**
 * Module 3, Impact and Effort (issue #233, FR-3.3), version 1: no outcome fields exist yet (phase 7), so it shows the effort mix and, where
 * set, the Primary KR start and target, and says how many initiatives have no KR. Key results are commercial: they are never sent to GitHub.
 */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** An initiative has a Primary KR when it names a metric or has a target value. */
export const hasKr = (r: ReportRow) => text(r.kr_metric) !== "" || num(r.kr_target) !== null;

export type EffortSize = { key: string; total: number; withKr: number; withoutKr: number };
export type KrLine = { id: string; effort: string; metric: string; start: number | null; target: number | null; unit: string; direction: string };

export function effortKr(rows: readonly ReportRow[]): { sizes: EffortSize[]; krs: KrLine[]; total: number; withKr: number; withoutKr: number } {
  const by = new Map<string, EffortSize>();
  const krs: KrLine[] = [];
  for (const r of rows) {
    const [effort] = valuesOf(r, "effort");
    const g = by.get(effort!) ?? { key: effort!, total: 0, withKr: 0, withoutKr: 0 };
    g.total += 1;
    if (hasKr(r)) {
      g.withKr += 1;
      krs.push({ id: r.id, effort: effort!, metric: text(r.kr_metric), start: num(r.kr_start), target: num(r.kr_target), unit: text(r.kr_unit), direction: text(r.kr_direction) });
    } else g.withoutKr += 1;
    by.set(effort!, g);
  }
  const sizes = [...by.values()].sort((a, b) => compareValues("effort", a.key, b.key));
  // largest effort first in the list, "not set" last
  krs.sort((a, b) => (a.effort === UNSET ? 1 : b.effort === UNSET ? -1 : compareValues("effort", b.effort, a.effort)));
  const withKr = sizes.reduce((n, g) => n + g.withKr, 0);
  return { sizes, krs, total: rows.length, withKr, withoutKr: rows.length - withKr };
}
