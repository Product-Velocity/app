import { CORE_COLUMN_KEYS } from "./views";
import { FIELD_BY_KEY } from "./registry";
import { STALL_DAYS } from "./attention";

/**
 * What a Cards card shows (decision 2026-11-22-card-layout.md). Four zones: a header (rank, code, tracker links, health), the name,
 * a row of up to five chosen fields, and a footer with the owner. Health, name, code and owner are fixed and do not use a slot.
 * The person chooses which fields; the type of each field decides where and how it is drawn.
 */
export const CARD_FIELD_LIMIT = 5;

/** On the card in a fixed place, so never one of the chosen fields. */
export const CARD_FIXED_KEYS: readonly string[] = [...CORE_COLUMN_KEYS, "health", "product_manager"];

/** How a chosen field is drawn: `size` the T-shirt circle, `pill` a value pill, `date` a date pill, `stat` a figure, `progress` a bar, `person` an avatar chip. */
export type CardRender = "size" | "pill" | "date" | "stat" | "progress" | "person" | "flag";

const RENDER_LABEL: Record<CardRender, string> = { size: "size circle", pill: "pill", date: "date", stat: "figure", progress: "progress bar", person: "avatar", flag: "pill" };
export const cardRenderLabel = (r: CardRender): string => RENDER_LABEL[r];

export type CardFieldOffer = { ok: true; render: CardRender } | { ok: false; reason: string };

const NOT_FOR_CARDS = new Set(["Long text", "Note", "Links", "Files", "Relation", "Thread", "Structured", "Date range", "People", "Text", "Person or text", "System"]);

/** Whether a field can be a card field, and how it is drawn. The reason is shown in the picker. */
export function cardFieldOffer(key: string): CardFieldOffer {
  const f = FIELD_BY_KEY[key];
  if (!f) return { ok: false, reason: "Unknown field" };
  if (CARD_FIXED_KEYS.includes(key)) return { ok: false, reason: "Always on the card" };
  if (key === "effort") return { ok: true, render: "size" };
  if (key.endsWith("_pct")) return { ok: true, render: "progress" };
  switch (f.type) {
    case "Select": case "Tags": return { ok: true, render: "pill" };
    case "Date": return { ok: true, render: "date" };
    case "Number": case "Currency": case "Computed": return { ok: true, render: "stat" };
    case "Person": return { ok: true, render: "person" };
    case "Boolean": return { ok: true, render: "flag" };
    default: return { ok: false, reason: NOT_FOR_CARDS.has(f.type) ? "Too long for a card" : "Not shown on cards" };
  }
}

/** The fields a card shows from a view's column list: eligible ones only, in the view's order, at most five, none of the fixed ones, none repeating a board axis. */
export function cardFieldKeys(columns: readonly string[], axes: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of columns) {
    if (seen.has(k) || axes.includes(k) || !cardFieldOffer(k).ok) continue;
    seen.add(k);
    out.push(k);
    if (out.length === CARD_FIELD_LIMIT) break;
  }
  return out;
}

/** The view's column list after the card fields were chosen: the three core columns, then the chosen fields. Health and the owner are fixed, not columns. */
export function cardColumns(chosen: readonly string[]): string[] {
  return [...CORE_COLUMN_KEYS, ...chosen.filter((k) => cardFieldOffer(k).ok).slice(0, CARD_FIELD_LIMIT)];
}

/** Text for a date field on a card: `Mar 12`, with the year only when it is not this year. Empty when there is no date. */
export function cardDate(value: unknown, today: Date): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  if (!mon) return "";
  return y === today.getUTCFullYear() ? `${mon} ${d}` : `${mon} ${d}, ${y}`;
}

// ---- MoSCoW and size

export type MoscowTone = "must" | "should" | "could" | "wont";
const MOSCOW: Record<string, MoscowTone> = { must: "must", should: "should", could: "could", "won't": "wont", wont: "wont" };
/** The fill weight of a MoSCoW value: strength shows as weight, not as a new colour (health owns green, amber and red). */
export const moscowTone = (value: string): MoscowTone | null => MOSCOW[value.trim().toLowerCase()] ?? null;

export const SIZE_ORDER = ["XS", "S", "M", "L", "XL"] as const;

/** "3L 1M 1S": the sizes of a column, biggest first. Items without a size are left out. */
export function sizeSummary(efforts: readonly unknown[]): string {
  const n = new Map<string, number>();
  for (const e of efforts) if (typeof e === "string" && (SIZE_ORDER as readonly string[]).includes(e)) n.set(e, (n.get(e) ?? 0) + 1);
  return [...SIZE_ORDER].reverse().filter((s) => n.has(s)).map((s) => `${n.get(s)}${s}`).join(" ");
}

// ---- how long in the stage

const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/**
 * Stage ageing: days in the current phase, shown only when the item is Active, in a phase with a usual limit and over half of it.
 * `over` says it is past the limit (same limits as Needs attention). About an initiative, never a person.
 */
export function stageAge(row: { initiative_phase?: unknown; phase_changed_at?: unknown; initiative_status?: unknown }, today: Date): { days: number; over: boolean } | null {
  const phase = typeof row.initiative_phase === "string" ? row.initiative_phase : "";
  const limit = STALL_DAYS[phase];
  if (!limit || typeof row.phase_changed_at !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(row.phase_changed_at)) return null;
  const st = typeof row.initiative_status === "string" ? row.initiative_status : "";
  if (["Completed", "Cancelled", "On hold", "Deferred"].includes(st)) return null;
  const days = Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000) - dayNum(row.phase_changed_at);
  if (days < Math.ceil(limit / 2)) return null;
  return { days, over: days > limit };
}

// ---- lane health bar

export type HealthSegment = { health: string; count: number };
const HEALTH_ORDER = ["Blocked", "Delayed", "At Risk", "On Track"];

/** Counts of each health in a lane, worst first, then "No health". Segments with no items are left out. */
export function healthSegments(healths: readonly unknown[]): HealthSegment[] {
  const n = new Map<string, number>();
  for (const h of healths) { const k = typeof h === "string" && h ? h : "No health"; n.set(k, (n.get(k) ?? 0) + 1); }
  return [...HEALTH_ORDER, "No health"].filter((h) => n.has(h)).map((h) => ({ health: h, count: n.get(h)! }));
}

/** Initials of a name for the avatar: "tom.reyes" gives "TR". */
export function initialsOf(name: string): string {
  const parts = name.split(/[._\s-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "").slice(0, 2)).toUpperCase();
}
