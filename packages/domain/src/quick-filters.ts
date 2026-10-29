import type { Filter } from "./views";

/**
 * The one-click filters of the filter panel. Each is a plain filter (or a few) in the view's list, so a saved view keeps them and the
 * chips and the row count treat them like any other filter. Dates are read against today, so "this week" is always this week.
 */
export type QuickFilter = { id: string; label: string; hint: string; filters: Filter[] };

export const QUICK_FILTERS: readonly QuickFilter[] = [
  { id: "created-today", label: "Created today", hint: "Created At is today", filters: [{ field: "created_at", op: "today" }] },
  { id: "created-week", label: "Created this week", hint: "Created At is this week (Monday to Sunday)", filters: [{ field: "created_at", op: "this_week" }] },
  { id: "created-month", label: "Created this month", hint: "Created At is this month", filters: [{ field: "created_at", op: "this_month" }] },
  { id: "mine", label: "My initiatives", hint: "I am the Product Manager", filters: [{ field: "product_manager", op: "is", value: "me" }] },
  { id: "high-impact", label: "High impact", hint: "MoSCoW is Must", filters: [{ field: "moscow", op: "is", value: "Must" }] },
  { id: "attention", label: "Needs attention", hint: "Health is At Risk, Delayed or Blocked", filters: [{ field: "health", op: "any_of", values: ["At Risk", "Delayed", "Blocked"] }] },
  { id: "active", label: "Active", hint: "Initiative Status is Active", filters: [{ field: "initiative_status", op: "is", value: "Active" }] },
];

export const sameFilter = (a: Filter, b: Filter) =>
  a.field === b.field && a.op === b.op && (a.value ?? "") === (b.value ?? "") && (a.value2 ?? "") === (b.value2 ?? "") && [...(a.values ?? [])].sort().join("|") === [...(b.values ?? [])].sort().join("|");

/** Is this quick filter on: are all its filters in the list? */
export const quickFilterOn = (filters: readonly Filter[], q: QuickFilter) => q.filters.every((qf) => filters.some((f) => sameFilter(f, qf)));

/** Turns a quick filter on (adds its filters) or off (removes them). The rest of the list is untouched. */
export function toggleQuickFilter(filters: readonly Filter[], q: QuickFilter): Filter[] {
  if (quickFilterOn(filters, q)) return filters.filter((f) => !q.filters.some((qf) => sameFilter(f, qf)));
  return [...filters, ...q.filters.filter((qf) => !filters.some((f) => sameFilter(f, qf)))];
}

/** The filters that are not one of the quick filters: what the rule builder lists. */
export const customFilters = (filters: readonly Filter[]): Filter[] =>
  filters.filter((f) => !QUICK_FILTERS.some((q) => q.filters.some((qf) => sameFilter(f, qf)) && quickFilterOn(filters, q)));
