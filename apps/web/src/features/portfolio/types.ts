import type { Role } from "@pv/domain";
import type { GithubLinkInfo } from "@/lib/github/push-types";

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
  members: { user_id: string; email: string; github_username?: string | null }[];
  /** Initiative Groups of the workspace (the list admins tidy up); the grid adds any group that is typed. */
  groups?: string[];
  /** Teams of the workspace, for Contributing Teams in the item panel. */
  teams?: { id: string; name: string }[];
  /** GitHub: whether the workspace is connected, and the tracking issue of each linked item. */
  github?: { connected: boolean; links: Record<string, GithubLinkInfo> };
};

export type { Role };

/** One epic (level 1) or task (level 2) under an initiative's tracking issue, as GitHub last reported it. */
export type IssueTreeRow = {
  repo: string; number: number; parentNumber: number | null; level: 1 | 2; title: string;
  state: "open" | "closed"; stateReason: string | null; assignees: string[]; createdBy: "app" | "claude" | "engineer"; updatedAt: string;
};

/** One row of the Trash: what was deleted, by whom and when (no commercial fields). */
export type TrashedItem = {
  id: string; item_code: string; initiative_name: string; home_project: string; theme: string | null;
  stack_rank: number; created_by: string | null; deleted_at: string; deleted_by: string | null;
};
