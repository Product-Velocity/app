/** The card a voter can open under "More" (issue #746, slice 3): Business Line, Business Value (12 months) and Effort. Pure rules, no I/O. */
export const VOTER_FIELDS = [
  { key: "business_line", label: "Business Line", commercial: false },
  { key: "business_value", label: "Business Value (12 months)", commercial: true },
  { key: "effort", label: "Effort", commercial: false },
] as const;
export type VoterField = (typeof VOTER_FIELDS)[number]["key"];
export const DEFAULT_VOTER_FIELDS: VoterField[] = VOTER_FIELDS.map((f) => f.key);

/** Only known keys, each once, in the card's own order. Anything else is dropped. */
export function cleanVoterFields(raw: unknown): VoterField[] {
  const given = new Set(Array.isArray(raw) ? raw.map(String) : []);
  return VOTER_FIELDS.filter((f) => given.has(f.key)).map((f) => f.key);
}

export type ShownCard = { businessLine: string | null; businessValue: number | string | null; effort: string | null };
export type CardRow = { label: string; value: string };

/** "€ 150,000" in the workspace's currency, or the plain number when the currency is unknown. */
export function formatValue(value: number | string, currency: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    if (currency && /^[A-Z]{3}$/.test(currency)) return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch { /* an unknown currency code falls back to the plain number */ }
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n);
}

/** The rows of the card for one initiative: only what the snapshot holds, so a field the admin left out is never shown, and an empty field is not shown either. */
export function cardRows(shown: ShownCard, currency: string | null): CardRow[] {
  const rows: CardRow[] = [];
  if (shown.businessLine && shown.businessLine.trim()) rows.push({ label: "Business Line", value: shown.businessLine.trim() });
  if (shown.businessValue !== null && shown.businessValue !== undefined && shown.businessValue !== "") rows.push({ label: "Business Value (12 months)", value: formatValue(shown.businessValue, currency) });
  if (shown.effort) rows.push({ label: "Effort", value: shown.effort });
  return rows;
}
