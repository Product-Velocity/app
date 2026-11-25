import { moscowTone, initialsOf } from "@pv/domain";

/** Small drawings of a value by its type, shared by the cards and the grid so one value looks the same in both (decision 2026-11-22-grid-matches-cards.md). The word or number is always in the text, never colour alone. */

/** MoSCoW by weight (Must solid blue, Should light blue, Could grey, Won't outlined); other words are left plain. */
export function MoscowPill({ value, name = "MoSCoW", className }: { value: string; name?: string; className?: string }) {
  const m = moscowTone(value);
  if (!m) return value ? <span>{value}</span> : null;
  return <span className={`pill kc-pill kc-moscow kc-moscow-${m}${className ? ` ${className}` : ""}`} title={`${name}: ${value}`}><span className="visually-hidden">{name} </span>{value}</span>;
}

/** The size circle of Effort (XS to XL). */
export function SizeDot({ value, name = "Effort" }: { value: string; name?: string }) {
  if (!value) return null;
  return <span className="kc-size" title={`${name}: ${value}`}><span className="visually-hidden">{name} </span>{value}</span>;
}

/** G2M Effort: a pill from green (XS) to red (XL). The size word is always in the text, never colour alone. Blank shows nothing. */
export const G2M_EFFORT_SIZES: readonly string[] = ["XS", "S", "M", "L", "XL"];
export function EffortPill({ value, name = "G2M Effort", className }: { value: string; name?: string; className?: string }) {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (!G2M_EFFORT_SIZES.includes(v)) return <span>{value}</span>;
  return <span className={`pill kc-pill kc-effort kc-effort-${v.toLowerCase()}${className ? ` ${className}` : ""}`} title={`${name}: ${v}`}><span className="visually-hidden">{name} </span>{v}</span>;
}

/** A percentage as a thin bar and its number (0 to 100, a fraction below 1 counts as a share). Returns null when the value is not a number. */
export function percentOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 1 && n > 0 && !Number.isInteger(n) ? n * 100 : n)));
}

export function ProgressMeter({ value, name }: { value: unknown; name: string }) {
  const pct = percentOf(value);
  if (pct === null) return null;
  return (
    <span className="kc-progress" title={`${name}: ${pct}%`}>
      <span className="kc-bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
      <span className="kc-pct">{pct}%</span>
    </span>
  );
}

/** A person as a round avatar with initials and the name. */
export function PersonChip({ text, name }: { text: string; name: string }) {
  if (!text) return null;
  return <span className="kc-owner" title={`${name}: ${text}`}><span className="kc-avatar" aria-hidden="true">{initialsOf(text.split("@")[0]!)}</span><span className="visually-hidden">{name} </span>{text}</span>;
}
