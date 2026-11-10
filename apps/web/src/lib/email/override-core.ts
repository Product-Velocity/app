import { templateByKey, type EmailKey, type TemplateText } from "./registry/registry";
import { validateTemplateText } from "./registry/validate";

export type OverrideRow = { subject: string; preheader: string; heading: string; body: string; button: string | null; note: string };

/**
 * The published wording of one email, or null for "send the code default" (issue #370 fallback). null covers: the store is off, the read
 * failed, nothing is published, or the published copy breaks the wording rules (HTML, links, unknown macros, ...). The rules are checked
 * here again on purpose: whatever got into the table, a bad copy is never sent. Never throws.
 */
export async function resolveOverride(key: EmailKey, fetchRow: (key: EmailKey) => Promise<OverrideRow | null>, log: (line: string) => void = (l) => console.error(l)): Promise<Partial<TemplateText> | null> {
  try {
    const row = await fetchRow(key);
    if (!row) return null;
    const text: TemplateText = { subject: row.subject, preheader: row.preheader, heading: row.heading, body: row.body, button: row.button, note: row.note };
    if (validateTemplateText(templateByKey(key), text).length > 0) {
      log(JSON.stringify({ emailOverride: "invalid-ignored", template: key }));
      return null;
    }
    return text;
  } catch {
    log(JSON.stringify({ emailOverride: "read-failed", template: key }));
    return null;
  }
}
