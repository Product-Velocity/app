import type { Role } from "@pv/domain";

/**
 * One row of the portfolio grid: every item field by its dictionary key (`initiative_name`, `value_12m`, ...),
 * plus `home_project` (the project id) and the computed `project_rank`, which the browser recalculates after a re-rank.
 */
export type LoadedItem = {
  id: string;
  item_code: string;
  initiative_name: string;
  stack_rank: number;
  home_project: string;
} & Record<string, unknown>;
export type GridItem = LoadedItem & { project_rank: number };

export type Lookups = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string }[];
  /** Initiative Groups of the workspace (the list admins tidy up); the grid adds any group that is typed. */
  groups?: string[];
  /** Teams of the workspace, for Contributing Teams in the item panel. */
  teams?: { id: string; name: string }[];
};

export type { Role };
