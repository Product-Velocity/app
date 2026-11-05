import type { ConfigRow } from "./mapping";

// "Switched off" lines of the Sync preview (decision 2026-11-03-tracker-field-config): when a field configuration leaves out something the initiative
// has a value for, the preview says so instead of staying silent. Only the GitHub slots are listed here; the Jira builder adds its own notes.

const HAS = (v: unknown) => v !== undefined && v !== null && v !== "";
const SLOT_TEXT: [string, string, (row: Record<string, unknown>, artifacts: number, files: number) => boolean][] = [
  ["github.label.moscow", "MoSCoW label", (r) => HAS(r.moscow)],
  ["github.label.rank", "rank label", (r) => HAS(r.stack_rank)],
  ["github.label.type", "Change Type label", (r) => HAS(r.change_type)],
  ["github.label.group", "Initiative Group label", (r) => HAS(r.theme)],
  ["github.label.quarter", "Planned Quarter label", (r) => HAS(r.g2m_quarter)],
  ["github.milestone", "milestone", (r) => HAS(r.g2m_date_est)],
  ["github.issueType", "issue type", (r) => HAS(r.change_type)],
  ["github.body.artifacts", "artifact links", (_r, a) => a > 0],
  ["github.body.files", "file links", (_r, _a, f) => f > 0],
];

/** One sentence per slot that is switched off while the initiative has something for it. */
export function switchedOffNotes(config: readonly ConfigRow[], row: Record<string, unknown>, artifacts: number, files: number): string[] {
  const off = new Set(config.filter((c) => !c.enabled).map((c) => c.slot));
  return SLOT_TEXT.filter(([slot, , has]) => off.has(slot) && has(row, artifacts, files)).map(([, what]) => `The ${what} is not sent: it is switched off in the field configuration.`);
}
