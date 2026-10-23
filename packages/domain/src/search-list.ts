import type { FieldDef } from "./registry";

/** A list with more than this many options gets a search box at the top (R-018). */
export const LONG_LIST = 8;
export const needsSearch = (count: number) => count > LONG_LIST;

export type ListOption = { value: string; label: string; /** Extra words that also match: aliases, keys. */ keywords?: string; /** Heading the option is listed under. */ group?: string; disabled?: boolean };

/** Lowercase, no accents, punctuation as spaces: "Estimate (weeks)" and "estimate weeks" are the same words. */
const words = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Header words an import accepts for a field ("owner" finds Product Manager); also what the search matches. */
const ALIASES: Record<string, string> = {
  initiative_name: "title name initiative", home_project: "project", product_manager: "owner pm manager", effort: "size tshirt t-shirt",
  value_12m: "value valueeur", start_date: "start", g2m_date_est: "end end date g2m", theme: "group", roadmap_category: "category",
  initiative_phase: "phase", summary: "description",
};

/** The fields as list options: name first, key and aliases as extra words, the field's group as heading. */
export function fieldOptions(fields: readonly FieldDef[]): ListOption[] {
  return fields.map((f) => ({ value: f.key, label: f.name, group: f.group, keywords: `${f.key} ${ALIASES[f.key] ?? ""}`.trim() }));
}

/**
 * The options that match what was typed: every word of the query must appear somewhere in the label or its extra words,
 * case-insensitive, anywhere in the name. A label that starts with the query comes first; otherwise the order is kept.
 */
export function filterOptions<T extends { label: string; keywords?: string }>(options: readonly T[], query: string): T[] {
  const q = words(query);
  if (q === "") return [...options];
  const parts = q.split(" ");
  const hits = options
    .map((o, i) => ({ o, i, label: words(o.label), all: words(`${o.label} ${o.keywords ?? ""}`) }))
    .filter((x) => parts.every((p) => x.all.includes(p)));
  const starts = (x: { label: string }) => (x.label.startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || a.i - b.i).map((x) => x.o);
}
