import type { Health, Moscow, Role, Size } from "@pv/domain";

/** One row of the portfolio grid. `project_rank` is derived in the browser. */
export type GridItem = {
  id: string;
  key: string;
  title: string;
  stack_rank: number;
  home_project_id: string;
  owner_user_id: string | null;
  moscow: Moscow | null;
  size: Size | null;
  health: Health | null;
  value: number | null;
  confidence: number | null;
  start_date: string | null;
  end_date: string | null;
  /** GitHub-driven: read-only here. */
  status: string | null;
  delivery_progress: number | null;
  project_rank: number;
};

export type Lookups = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string }[];
};

export type { Role };
