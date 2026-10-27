import { formatDate, formatValue, type FieldDef } from "@pv/domain";

const num = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const whenWithTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type FormatCtx = {
  today: Date;
  members: { user_id: string; email: string }[];
  projects: { id: string; name: string }[];
};

/** A field value as text, the same in the grid cell and in the item panel. */
export function formatField(f: FieldDef, v: unknown, ctx: FormatCtx): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "Currency": return formatValue(Number(v));
    case "Date": return formatDate(String(v), ctx.today);
    case "Boolean": return v ? "Yes" : "No";
    case "Person": return ctx.members.find((m) => m.user_id === v)?.email ?? "unknown person";
    case "Number": case "Computed": case "System":
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (typeof v === "number") return f.key.endsWith("_pct") ? `${num.format(v)}%` : f.key.endsWith("_pp") ? `${num.format(v)} pp` : num.format(v);
      if (typeof v === "object") return JSON.stringify(v);
      if (f.key === "last_synced" && /^\d{4}-\d\d-\d\dT/.test(String(v))) return whenWithTime.format(new Date(String(v))); // a time, not only a day
      if (/^\d{4}-\d\d-\d\dT/.test(String(v))) return when.format(new Date(String(v)));
      return String(v);
    case "Structured":
      return typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, n]) => `${k} ${n}`).join(", ") : String(v);
    default:
      if (f.key === "home_project") return ctx.projects.find((p) => p.id === v)?.name ?? "";
      return String(v);
  }
}
