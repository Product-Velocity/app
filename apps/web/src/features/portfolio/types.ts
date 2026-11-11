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

/** A Jira link of an initiative: the issue, who owns the initiative, and what Jira says about it. */
export type JiraLinkInfo = { mode: "push" | "follow"; issueKey: string; url: string | null; status: string | null; category: "new" | "indeterminate" | "done" | null; lastSynced: string | null };

export type Lookups = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string; github_username?: string | null }[];
  /** Initiative Groups of the workspace (the list admins tidy up); the grid adds any group that is typed. */
  groups?: string[];
  /** Teams of the workspace, for Contributing Teams in the item panel. */
  teams?: { id: string; name: string }[];
  /** GitHub: whether the workspace is connected, and the tracking issue of each linked item. */
  /** Ids of initiatives whose tracker link is frozen (docs/28-DECISION-GATES.md section 9). */
  frozen?: string[];
  github?: { connected: boolean; links: Record<string, GithubLinkInfo> };
  /** The Jira issue each linked initiative follows or owns (a link to Jira, from item_jira_links). */
  jira?: { links: Record<string, JiraLinkInfo> };
  /** Jira: whether the workspace has a connected Jira sign-in, and the tracker of each project (decides what the Sync button is called). */
  trackers?: { jira: boolean; projectTracker: Record<string, "github" | "jira" | null> };
  /** The organization currency (ISO code, from Workspace settings): the unit of Business Value. Null until an admin sets it. */
  currency?: string | null;
};

export type { Role };

/** One epic (level 1) or task (level 2) under an initiative's tracking issue, as GitHub last reported it. */
export type IssueTreeRow = {
  repo: string; number: number; parentNumber: number | null; level: 1 | 2; title: string;
  state: "open" | "closed"; stateReason: string | null; assignees: string[]; createdBy: "app" | "claude" | "engineer"; updatedAt: string;
};

/** One child (level 1) or sub-task (level 2) of the Jira issue an initiative is linked to, as Jira last reported it. Read only. */
export type JiraTreeRow = {
  key: string; parentKey: string; level: 1 | 2; position: number; title: string; type: string | null; status: string | null;
  category: "new" | "indeterminate" | "done" | null; assignee: string | null; url: string | null; updatedAt: string | null;
  /** Set when the row comes from the issue list read earlier, not from the full read of the children (no assignee is known). */
  fromList?: true;
};

/** One row of the Trash: what was deleted, by whom and when (no commercial fields). */
export type TrashedItem = {
  id: string; item_code: string; initiative_name: string; home_project: string; theme: string | null;
  stack_rank: number; created_by: string | null; deleted_at: string; deleted_by: string | null;
};
