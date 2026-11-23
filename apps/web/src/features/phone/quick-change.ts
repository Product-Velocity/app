/**
 * Quick actions on a phone (issue #635, slice P4b): change Health or Initiative Status of one initiative, with a short reason. Pure rules, the same as the database
 * function item_quick_change that enforces them. Initiative Phase is not here (it goes through a decision gate), and neither is anything a tracker owns (rule 6).
 */
export type QuickField = "health" | "initiative_status";
export type QuickOption = { value: string; label: string; hint?: string };

export const QUICK_FIELDS: Record<QuickField, { label: string; options: QuickOption[]; concern: readonly string[] }> = {
  health: {
    label: "Health",
    options: [{ value: "On Track", label: "On Track" }, { value: "At Risk", label: "At Risk" }, { value: "Delayed", label: "Delayed" }, { value: "Blocked", label: "Blocked" }],
    concern: ["At Risk", "Delayed", "Blocked"],
  },
  initiative_status: {
    label: "Status",
    options: [{ value: "Backlog", label: "Backlog" }, { value: "Active", label: "Active" }, { value: "On hold", label: "On hold" }, { value: "Completed", label: "Completed" }, { value: "Cancelled", label: "Cancelled" }],
    concern: ["On hold", "Cancelled"],
  },
};

export const NOTE_MIN = 4;
export const NOTE_MAX = 300;

/** A concern needs a reason, in a few words; anything else may have one. */
export const noteRequired = (field: QuickField, value: string): boolean => QUICK_FIELDS[field].concern.includes(value);

/** What is wrong with this change, in words for the person, or null when it can be saved. */
export function quickChangeProblem(field: QuickField, current: string | null, value: string | null, note: string): string | null {
  if (!value) return "Choose a value.";
  if (value === current) return `It is already ${value}.`;
  const n = note.trim();
  if (n.length > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`;
  if (noteRequired(field, value) && n.length < NOTE_MIN) return "Say why in a few words.";
  return null;
}

/** "Health: On Track → At Risk", for the confirmation line. */
export const quickChangeText = (field: QuickField, from: string | null, to: string) => `${QUICK_FIELDS[field].label}: ${from ?? "not set"} → ${to}`;
