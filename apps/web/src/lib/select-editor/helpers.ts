// Pure helpers of the shared "Initiative fields" editor (Jira and GitHub): suggestions, completeness, the warning for a field named like a built-in, and the
// list of values to create in the tracker. No network, no React, so the rules are tested without a browser.

export type EditorOption = { value: string; label: string };
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A first proposal: the option with the same name as the value (case and spaces ignored), one option for one value. Only a proposal: a person confirms with Save. */
export function suggestOptions(values: readonly string[], options: readonly EditorOption[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const v of values) {
    const hit = options.find((o) => norm(o.label) === norm(v) && !used.has(o.value));
    if (hit) { out[v] = hit.value; used.add(hit.value); }
  }
  return out;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export function completeness(values: readonly string[], chosen: Record<string, string>): { mapped: number; total: number; missing: string[]; text: string } {
  const missing = values.filter((v) => !chosen[v]);
  const mapped = values.length - missing.length;
  const text = missing.length === 0 ? `All ${values.length} values mapped.` : `${mapped} of ${values.length} values mapped. ${list(missing)} ${missing.length === 1 ? "is" : "are"} not mapped, so ${missing.length === 1 ? "it" : "they"} won't be sent.`;
  return { mapped, total: values.length, missing, text };
}

const BUILT_IN = new Set(["priority", "status", "resolution", "assignee", "reporter", "labels", "summary", "description", "issue type", "due date", "created", "updated", "project", "components", "sprint"]);
/** A custom field can be named like a built-in (RR has a custom "Priority"): easy to pick by mistake. */
export const looksLikeBuiltIn = (name: string) => BUILT_IN.has(norm(name));

/** What to create in the tracker so its options match Product Velocity's values exactly. */
export const createListText = (slots: { label: string; values: readonly string[] }[]) => slots.map((s) => `${s.label}: ${s.values.join(", ")}`).join("\n");
