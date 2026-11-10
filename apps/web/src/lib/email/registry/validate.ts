import { validateMacros, validatePlainText } from "./macros";
import type { EmailTemplate, TemplateText } from "./registry";

/** Limits match the database (platform.email_template_versions). */
const LIMITS: Record<keyof TemplateText, { min: number; max: number; label: string }> = {
  subject: { min: 1, max: 200, label: "Subject" },
  preheader: { min: 0, max: 200, label: "Preheader" },
  heading: { min: 1, max: 200, label: "Heading" },
  body: { min: 1, max: 4000, label: "Body" },
  button: { min: 1, max: 60, label: "Button label" },
  note: { min: 0, max: 600, label: "Footer note" },
};

export const FIELD_LABELS: Record<keyof TemplateText, string> = Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.label])) as Record<keyof TemplateText, string>;
export const editableFields = (t: EmailTemplate): readonly (keyof TemplateText)[] => t.editable ?? ["subject", "preheader", "heading", "body", "button", "note"];

/**
 * Problems that stop a save, a publish, a test send and the load for sending (issue #370): text only (no HTML, no scripts, no typed
 * links), only the macros this template allows, sensible lengths, and no button added or removed (the button is part of the frame).
 * Returns plain sentences; an empty list means the wording is fine.
 */
export function validateTemplateText(t: EmailTemplate, text: TemplateText): string[] {
  const problems: string[] = [];
  const editable = editableFields(t);
  for (const f of Object.keys(LIMITS) as (keyof TemplateText)[]) {
    const raw = text[f];
    if (f === "button") {
      if (t.button === null && raw !== null) problems.push("This email has no button; its wording cannot add one.");
      if (t.button !== null && (raw === null || raw === "")) problems.push("The button label cannot be empty.");
      if (raw === null) continue;
    }
    const value = raw ?? "";
    const { min, max, label } = LIMITS[f];
    if (!editable.includes(f) && value !== (t[f] ?? "")) problems.push(`${label} cannot be changed for this email.`);
    if (value.trim().length < min) problems.push(`${label} cannot be empty.`);
    if (value.length > max) problems.push(`${label} is too long (at most ${max} characters).`);
    if ((f === "subject" || f === "heading" || f === "button" || f === "preheader") && /[\r\n]/.test(value)) problems.push(`${label} must be one line.`);
    for (const p of validateMacros(value, t.macros)) problems.push(`${label}: ${p}`);
    for (const p of validatePlainText(value)) problems.push(`${label}: ${p}`);
  }
  return problems;
}
