/** Sorting for the list screens: the sort the person chose on the column headers (first entry wins), applied to the rows we hand the grid. Empty values sort last in either direction; text compares as words and numbers (R-2 before R-10). */
export type SortEntry = { colId: string; sort: "asc" | "desc" };
export type SortValue = string | number | null | undefined;

const text = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const cmp = (a: SortValue, b: SortValue) => (typeof a === "number" && typeof b === "number" ? a - b : text.compare(String(a), String(b)));

export function sortListRows<T>(rows: readonly T[], model: readonly SortEntry[], by: Readonly<Record<string, (r: T) => SortValue>>): T[] {
  const keys = model.filter((m) => by[m.colId]);
  if (keys.length === 0) return [...rows];
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((x, y) => {
    for (const k of keys) {
      const a = by[k.colId]!(x.r), b = by[k.colId]!(y.r);
      const ea = a === null || a === undefined || a === "", eb = b === null || b === undefined || b === "";
      if (ea || eb) { if (ea && eb) continue; return ea ? 1 : -1; }
      const c = cmp(a, b);
      if (c !== 0) return k.sort === "desc" ? -c : c;
    }
    return x.i - y.i;
  });
  return indexed.map((x) => x.r);
}
