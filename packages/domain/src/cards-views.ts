import { sanitizeView, type ViewDef } from "./views";
import type { ViewName } from "./registry";

/** The four default views of the Cards screen (issue #371, R-151). */
export const CARDS_VIEW_NAMES = ["Prioritisation", "Planning", "Delivery", "Go-to-market"] as const satisfies readonly ViewName[];
export type CardsViewName = (typeof CARDS_VIEW_NAMES)[number];

/**
 * Pre-configured default definitions for the Cards screen's four built-in views:
 * each has 5 columns (3 core + 2 extra fields), a swimlane grouping (`groupBy`), and tailored filters.
 */
export const CARDS_DEFAULT_VIEWS: Readonly<Record<CardsViewName, ViewDef>> = {
  Prioritisation: sanitizeView({
    columns: ["stack_rank", "item_code", "initiative_name", "effort", "moscow"],
    filters: [],
    groupBy: "theme",
  }),
  Planning: sanitizeView({
    columns: ["stack_rank", "item_code", "initiative_name", "g2m_quarter", "g2m_date_est"],
    filters: [{ field: "initiative_phase", op: "any_of", values: ["Discover", "Define", "Build"] }],
    groupBy: "g2m_quarter",
  }),
  Delivery: sanitizeView({
    columns: ["stack_rank", "item_code", "initiative_name", "status", "delivery_progress_pct"],
    filters: [{ field: "initiative_phase", op: "any_of", values: ["Build", "Test", "Experiment"] }],
    groupBy: "home_project",
  }),
  "Go-to-market": sanitizeView({
    columns: ["stack_rank", "item_code", "initiative_name", "g2m_date_est", "audience"],
    filters: [{ field: "initiative_phase", op: "any_of", values: ["Test", "Experiment", "Roll-out"] }],
    groupBy: "audience",
  }),
};
