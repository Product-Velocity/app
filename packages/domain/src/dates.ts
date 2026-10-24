export type DateResult = { ok: true; iso: string | null } | { ok: false; error: string };

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const HELP = "Could not read that date. Try 31/03/2027, 31 Mar, next friday or Q2.";

// ------------------------------------------------------------------ the person's date format
/** What a person chose in their account ("locale" follows the browser) and what that resolves to. */
export type DateFormat = "locale" | "d MMM yyyy" | "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";
export type ResolvedDateFormat = Exclude<DateFormat, "locale">;
export const DATE_FORMAT_VALUES: readonly DateFormat[] = ["locale", "d MMM yyyy", "dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd"];

/** The order a locale writes numeric dates in: Dutch and British give dd/mm/yyyy, American mm/dd/yyyy, Swedish and Canadian French yyyy-mm-dd. */
export function resolveDateFormat(format: DateFormat, locale?: string): ResolvedDateFormat {
  if (format !== "locale") return format;
  try {
    const parts = new Intl.DateTimeFormat(locale || "en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.UTC(2026, 10, 25)));
    const order = parts.filter((p) => p.type === "day" || p.type === "month" || p.type === "year").map((p) => p.type[0]).join("");
    if (order === "mdy") return "mm/dd/yyyy";
    if (order === "ymd") return "yyyy-mm-dd";
  } catch { /* an unknown locale: day first */ }
  return "dd/mm/yyyy";
}

// One setting for the whole page (the browser runs one person at a time). The default keeps the older words format; the app sets the
// person's own choice once at start, so every date shown, typed, pasted or imported follows it.
let current: ResolvedDateFormat = "d MMM yyyy";
export function setDateFormat(format: DateFormat, locale?: string): void { current = resolveDateFormat(format, locale); }
export function getDateFormat(): ResolvedDateFormat { return current; }
/** Which number comes first when someone types 03/04/2026. Year-first and word formats read it as day first. */
const numericOrder = (): "dmy" | "mdy" => (current === "mm/dd/yyyy" ? "mdy" : "dmy");
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Today as a UTC date for the person's local calendar day. */
export function localToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function build(y: number, m: number, d: number, label: string): DateResult {
  if (y < 1970 || y > 2100) return { ok: false, error: "Use a year between 1970 and 2100." };
  if (m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return { ok: false, error: `That day does not exist: ${label}.` };
  return { ok: true, iso: iso(y, m, d) };
}

function addDays(t: Date, n: number): Date {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n));
}
const fromDate = (t: Date): DateResult => ({ ok: true, iso: iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) });

/**
 * Plain-language dates. Numeric dates are day/month (European). `edge` decides
 * what a period such as "Q2" or "march" means: its first day for a start
 * column, its last day for an end column.
 */
export function parseDate(input: string, today: Date, opts: { edge?: "start" | "end" } = {}): DateResult {
  const edge = opts.edge ?? "start";
  let s = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (s === "") return { ok: true, iso: null };
  s = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1").replace(/^(\d{1,2}) of /, "$1 ");
  const ty = today.getUTCFullYear(), tm = today.getUTCMonth(), td = today.getUTCDate(), twd = today.getUTCDay();
  const year2 = (v: string) => (v.length === 2 ? 2000 + Number(v) : Number(v));
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return build(+m[1]!, +m[2]! - 1, +m[3]!, input.trim());
  if ((m = s.match(/^(\d{1,2})[./ -](\d{1,2})(?:[./ -](\d{2}|\d{4}))?$/))) {
    const [a, b] = numericOrder() === "mdy" ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!]; // day, month
    return build(m[3] ? year2(m[3]) : ty, b - 1, a, input.trim());
  }
  // typed without separators: 310326 or 31032026 (day, month, year in the person's order)
  if ((m = s.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/))) {
    const [a, b] = numericOrder() === "mdy" ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!];
    return build(year2(m[3]!), b - 1, a, input.trim());
  }
  if ((m = s.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/)) && m[2]! in MONTHS) {
    return build(m[3] ? +m[3] : ty, MONTHS[m[2]!]!, +m[1]!, input.trim());
  }
  if ((m = s.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/)) && m[1]! in MONTHS) {
    return build(m[3] ? +m[3] : ty, MONTHS[m[1]!]!, +m[2]!, input.trim());
  }

  if (s === "today") return fromDate(today);
  if (s === "tomorrow") return fromDate(addDays(today, 1));
  if (s === "yesterday") return fromDate(addDays(today, -1));
  if ((m = s.match(/^in (\d{1,3}) (day|days|week|weeks|month|months)$/))) {
    const n = +m[1]!;
    if (m[2]!.startsWith("day")) return fromDate(addDays(today, n));
    if (m[2]!.startsWith("week")) return fromDate(addDays(today, 7 * n));
    const total = tm + n, y = ty + Math.floor(total / 12), mo = total % 12;
    return build(y, mo, Math.min(td, daysInMonth(y, mo)), input.trim());
  }
  if (s === "next week") return fromDate(addDays(today, ((1 - twd + 7) % 7) || 7));
  if (s === "next month") return build(tm === 11 ? ty + 1 : ty, (tm + 1) % 12, 1, input.trim());
  if ((m = s.match(/^(?:next )?([a-z]+)$/)) && m[1]! in WEEKDAYS) {
    return fromDate(addDays(today, ((WEEKDAYS[m[1]!]! - twd + 7) % 7) || 7));
  }

  if (s === "end of month") return build(ty, tm, daysInMonth(ty, tm), input.trim());
  if (s === "end of year" || s === "eoy") return build(ty, 11, 31, input.trim());

  const quarter = (q: number, y: number, end: boolean) =>
    end ? build(y, q * 3 - 1, daysInMonth(y, q * 3 - 1), input.trim()) : build(y, (q - 1) * 3, 1, input.trim());
  if ((m = s.match(/^(end of )?q([1-4])(?: (\d{4}))?$/))) return quarter(+m[2]!, m[3] ? +m[3] : ty, !!m[1] || edge === "end");
  if ((m = s.match(/^(\d{4}) q([1-4])$/))) return quarter(+m[2]!, +m[1]!, edge === "end");

  if ((m = s.match(/^(end of )?([a-z]+)(?: (\d{4}))?$/)) && m[2]! in MONTHS) {
    const y = m[3] ? +m[3] : ty, mo = MONTHS[m[2]!]!;
    return build(y, mo, m[1] || edge === "end" ? daysInMonth(y, mo) : 1, input.trim());
  }
  return { ok: false, error: HELP };
}

/** In the person's format: 31/03/2027, 03/31/2027, 2027-03-31, or the words "31 Mar" ("5 Jan 2028" when the year is not the current one). Can be typed back. */
export function formatDate(value: string | null | undefined, today: Date): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const [y, mo, d] = [m[1]!, m[2]!, m[3]!];
  if (current === "dd/mm/yyyy") return `${d}/${mo}/${y}`;
  if (current === "mm/dd/yyyy") return `${mo}/${d}/${y}`;
  if (current === "yyyy-mm-dd") return `${y}-${mo}-${d}`;
  const day = +d, month = MONTH_SHORT[+mo - 1];
  return +y === today.getUTCFullYear() ? `${day} ${month}` : `${day} ${month} ${y}`;
}

/** The format written as a hint: dd/mm/yyyy. */
export const dateFormatHint = (): string => (current === "d MMM yyyy" ? "31 Mar 2027" : current);
