import { sanitizeView, type ViewDef } from "./views";
import type { ViewName } from "./registry";

/** The three default views of the Gantt (issue #622): they reuse the names of the first three grid views, as Cards does. */
export const GANTT_VIEW_NAMES = ["Prioritisation", "Planning", "Delivery"] as const satisfies readonly ViewName[];
export type GanttViewName = (typeof GANTT_VIEW_NAMES)[number];

export const GANTT_DEFAULT_VIEWS: Readonly<Record<GanttViewName, ViewDef>> = {
  /** Everything, by group then project, a month per column: the Gantt as it was. */
  Prioritisation: sanitizeView({ columns: [], filters: [], groupBy: null, gantt: { zoom: "month", g1: "theme", g2: "home_project", density: "compact" } }),
  /** What is not built yet, by planned quarter then group, a quarter per column. */
  Planning: sanitizeView({ columns: [], filters: [{ field: "initiative_phase", op: "any_of", values: ["Discover", "Define", "Build"] }], groupBy: null, gantt: { zoom: "quarter", g1: "g2m_quarter", g2: "theme", density: "compact" } }),
  /** What is being built or tested, by project then team, a week per column, taller rows. */
  Delivery: sanitizeView({ columns: [], filters: [{ field: "initiative_phase", op: "any_of", values: ["Build", "Test", "Experiment"] }], groupBy: null, gantt: { zoom: "week", g1: "home_project", g2: "team", density: "comfortable" } }),
};
