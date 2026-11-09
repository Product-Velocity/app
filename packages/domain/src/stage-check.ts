import { gateOfPhase, type GateId } from "./gates";

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * The stage check (docs/29-MOBILE.md, Ashu 2026-11-09: "an initiative that fails its stage check is a placeholder"): what an initiative
 * still lacks for the stage it is in. It uses the fields of the gate it has to pass next (docs/28 section 3), without the document checks
 * (documents are not loaded with the list). Informs only; nothing is blocked.
 */
export function stageMissing(row: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!filled(row.initiative_name)) missing.push("Name");
  if (!filled(row.home_project)) missing.push("Project");
  if (!filled(row.hypothesis)) missing.push("Hypothesis");
  const gate: GateId | null = gateOfPhase(row.initiative_phase);
  if (gate === "A" && !filled(row.kr_metric)) missing.push("Primary key result");
  if (gate === "B") {
    if (!filled(row.effort)) missing.push("Effort");
    if (!filled(row.moscow)) missing.push("MoSCoW");
  }
  if (gate === "C" && !filled(row.start_experiment)) missing.push("Experiment start");
  return missing;
}

/** A placeholder: still active and missing something for its stage. Finished and stopped initiatives are never placeholders. */
export const isPlaceholder = (row: Record<string, unknown>): boolean =>
  !["Completed", "Cancelled"].includes(String(row.initiative_status ?? "")) && row.initiative_phase !== "Completed" && stageMissing(row).length > 0;
