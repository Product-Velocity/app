import { parseDate } from "./dates";
import { parseValue } from "./money";

export type Role = "viewer" | "commenter" | "creator" | "admin" | "leadership";
export type Moscow = "must" | "should" | "could" | "wont";
export type Size = "XS" | "S" | "M" | "L" | "XL";
export type Health = "on_track" | "at_risk" | "delayed";

export const EDITABLE_FIELDS = [
  "title", "home_project_id", "owner_user_id", "moscow", "size", "health", "value", "confidence", "start_date", "end_date",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABEL: Record<EditableField, string> = {
  title: "Initiative", home_project_id: "Project", owner_user_id: "Owner", moscow: "MoSCoW", size: "Size",
  health: "Health", value: "Value", confidence: "Confidence", start_date: "Start", end_date: "End",
};

/** Set by the GitHub sync only; the grid never lets a person edit them. */
export const LOCKED_FIELDS = {
  status: "Status comes from GitHub and cannot be edited here. Change it on the GitHub issue.",
  delivery_progress: "Progress comes from the GitHub sub-issues and cannot be edited here.",
} as const;

export type Option<V extends string> = { value: V; label: string };
export const MOSCOW_OPTIONS: Option<Moscow>[] = [
  { value: "must", label: "Must" }, { value: "should", label: "Should" },
  { value: "could", label: "Could" }, { value: "wont", label: "Won't" },
];
export const SIZE_OPTIONS: Option<Size>[] = (["XS", "S", "M", "L", "XL"] as const).map((v) => ({ value: v, label: v }));
export const HEALTH_OPTIONS: Option<Health>[] = [
  { value: "on_track", label: "On track" }, { value: "at_risk", label: "At risk" }, { value: "delayed", label: "Delayed" },
];

const OPTIONS = { moscow: MOSCOW_OPTIONS, size: SIZE_OPTIONS, health: HEALTH_OPTIONS } as const;

export function optionLabel(field: "moscow" | "size" | "health", value: string | null | undefined): string {
  return (OPTIONS[field] as Option<string>[]).find((o) => o.value === value)?.label ?? "";
}

/** The database allows writes by creators and admins; the grid mirrors that. */
export function canEditItems(role: string | null | undefined): boolean {
  return role === "creator" || role === "admin";
}

export type EditResult = { ok: true; value: string | number | null } | { ok: false; error: string };

/** Turn what a person typed (or picked) into the value to save, or say what is wrong. */
export function validateEdit(field: EditableField, raw: string, ctx: { today?: Date } = {}): EditResult {
  const text = raw.trim();
  switch (field) {
    case "title":
      if (text === "") return { ok: false, error: "An initiative needs a name." };
      if (text.length > 300) return { ok: false, error: "Keep the name under 300 characters." };
      return { ok: true, value: text };
    case "home_project_id":
      return text === "" ? { ok: false, error: "Choose a project." } : { ok: true, value: text };
    case "owner_user_id":
      return { ok: true, value: text === "" ? null : text };
    case "moscow": case "size": case "health":
      if (text === "") return { ok: true, value: null };
      return (OPTIONS[field] as Option<string>[]).some((o) => o.value === text)
        ? { ok: true, value: text }
        : { ok: false, error: "Choose one of the listed options." };
    case "confidence": {
      if (text === "") return { ok: true, value: null };
      const n = /^\d+%?$/.test(text) ? Number(text.replace("%", "")) : NaN;
      return Number.isInteger(n) && n >= 0 && n <= 100 ? { ok: true, value: n } : { ok: false, error: "Enter a whole number from 0 to 100." };
    }
    case "value": {
      const r = parseValue(text);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case "start_date": case "end_date": {
      const r = parseDate(text, ctx.today ?? new Date(), { edge: field === "start_date" ? "start" : "end" });
      return r.ok ? { ok: true, value: r.iso } : r;
    }
    default:
      return { ok: false, error: "That field cannot be edited." };
  }
}
