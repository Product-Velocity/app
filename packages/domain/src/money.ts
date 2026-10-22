export type MoneyResult = { ok: true; value: number | null } | { ok: false; error: string };

const MAX = 999_999_999_999.99;
const HELP = "Enter a number such as 1200, 1,200 or 120k.";

/** A plain amount: "1200", "1,200", "120k", "1.2m", "€ 450K", "2,5k". Empty clears. */
export function parseValue(input: string): MoneyResult {
  let s = input.trim().replace(/[€$£]/g, "").replace(/\s+/g, "");
  if (s === "") return { ok: true, value: null };
  let mult = 1;
  const suffix = s.match(/[kKmM]$/);
  if (suffix) {
    mult = suffix[0].toLowerCase() === "k" ? 1_000 : 1_000_000;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, error: HELP };
  let body: string;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) body = s.replace(/,/g, ""); // 1,200,000
  else if (/^\d+,\d+$/.test(s)) body = s.replace(",", "."); // 2,5 (comma as the decimal mark)
  else if (/^\d+(\.\d+)?$/.test(s)) body = s;
  else return { ok: false, error: HELP };
  const value = Math.round(Number(body) * mult * 100) / 100;
  if (!Number.isFinite(value) || value < 0 || value > MAX) return { ok: false, error: "That amount is too large." };
  return { ok: true, value };
}

export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}
