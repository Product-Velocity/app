/**
 * Planned Quarter (R-114): a calendar quarter and year such as "Q3 2027", chosen by a person.
 * Calendar quarters only, no fiscal calendars. The key stays `g2m_quarter` so saved views, filters, imports and API clients keep working.
 */
const QUARTER = /^Q([1-4]) (\d{4})$/;
// "Q3 2027", "Q3-2027", "2027-Q3" and, with a two-digit year, "Q4-26", "Q4 26", "Q4/26", "Q4\u201926" and "26-Q4" (the years 2000 to 2099).
const LOOSE = /^(?:Q([1-4])[\s\-/'\u2019]*(\d{4}|\d{2})|(\d{4}|\d{2})[\s\-/'\u2019]*Q([1-4]))$/i;

export const quarterLabel = (year: number, q: number) => `Q${q} ${year}`;
export const isQuarter = (v: unknown): v is string => typeof v === "string" && QUARTER.test(v) && Number(QUARTER.exec(v)![2]) >= 1900;

/** "q3 2027", "2027-Q3", "Q3-2027" and "Q3-27" all mean "Q3 2027"; anything else is not a quarter. */
export function parseQuarter(text: string): string | null {
  const t = text.trim();
  const m = LOOSE.exec(t);
  if (!m) return null;
  const q = Number(m[1] ?? m[4]);
  const ys = m[2] ?? m[3] ?? "";
  const y = ys.length === 2 ? 2000 + Number(ys) : Number(ys);
  return y >= 1900 && y <= 2999 ? quarterLabel(y, q) : null;
}

/** The quarter a date (YYYY-MM-DD) falls in, or null. */
export function quarterOfDate(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? quarterLabel(Number(m[1]), Math.ceil(month / 3)) : null;
}

/** Sort key: year, then quarter. */
const rank = (v: string) => { const m = QUARTER.exec(v)!; return Number(m[2]) * 4 + Number(m[1]); };
export const compareQuarters = (a: string, b: string) => rank(a) - rank(b);

/** From the previous year through the next three years: 16 quarters, moving forward as time passes. */
export function generatedQuarters(today: Date = new Date()): string[] {
  const y = today.getUTCFullYear();
  const out: string[] = [];
  for (let year = y - 1; year <= y + 3; year++) for (let q = 1; q <= 4; q++) out.push(quarterLabel(year, q));
  return out;
}

/** The choices to offer: the generated range plus every value already in use, in time order (a value in use is always selectable). */
export function quarterChoices(inUse: Iterable<unknown> = [], today: Date = new Date()): string[] {
  const set = new Set(generatedQuarters(today));
  for (const v of inUse) if (isQuarter(v)) set.add(v);
  return [...set].sort(compareQuarters);
}

/** Both set, and the G2M date (est) falls outside the planned quarter: shown as a hint, never changed automatically (FR-5). */
export function quarterMismatch(planned: unknown, g2mDateEst: unknown): boolean {
  if (!isQuarter(planned)) return false;
  const actual = quarterOfDate(g2mDateEst);
  return actual !== null && actual !== planned;
}
