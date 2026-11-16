import { TrackerStatusHeader, type StatusChip } from "@/components/tracker-status-header";
import type { ConnectionRow } from "@/lib/github/server";
import { setupSteps, type TrackerSection } from "@/lib/tracker-fields/sections";
import { requireWorkspace } from "@/lib/session";
import { STATE } from "./shared";

type Supabase = Awaited<ReturnType<typeof requireWorkspace>>["supabase"];
type Conn = (ConnectionRow & { account_login?: string | null; repository_selection?: string | null; last_check_at?: string | null; last_check_summary?: string | null }) | null;

export const GITHUB_BASE = "/settings/integrations/github";

/** The top of every GitHub settings section: name, state, the counts that matter, the next step and the five sections (decision 2026-11-16-tracker-settings-sections). */
export async function GithubHeader({ supabase, tenantId, c, current }: { supabase: Supabase; tenantId: string; c: Conn; current: TrackerSection }) {
  const connected = c?.state === "connected";
  const [{ data: projectRows }, { count: configured }] = await Promise.all([
    supabase.from("projects").select("id, tracker").eq("tenant_id", tenantId),
    connected ? supabase.from("tracker_field_config").select("project_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("provider", "github") : Promise.resolve({ count: 0 }),
  ]);
  const using = ((projectRows ?? []) as { tracker: string | null }[]).filter((p) => p.tracker === "github").length;
  const steps = setupSteps({ tracker: "GitHub", connected, linkedProjects: using, customised: (configured ?? 0) > 0 });
  const chips: StatusChip[] = connected
    ? [
        using > 0 ? { text: `${using} project${using === 1 ? "" : "s"} use GitHub`, section: "projects" } : { text: "No project uses GitHub yet", section: "projects", tone: "warn" },
        { text: (configured ?? 0) > 0 ? "Field mapping customised" : "Default field mapping", section: "mapping" },
        { text: c?.last_check_at ? `Last check ${new Date(c.last_check_at).toLocaleString("en-GB")}` : "Not checked yet", section: "logs" },
      ]
    : [];
  const state = STATE[c?.state ?? "disconnected"];
  const tone = connected ? "ok" : c && c.state !== "disconnected" ? "warn" : "off";
  const summary = c?.account_login ? `${c.account_login} (${c.repository_selection === "all" ? "all repositories" : "selected repositories"})` : c?.expected_account ?? undefined;
  return (
    <TrackerStatusHeader
      tracker="GitHub" base={GITHUB_BASE} current={current} state={state} tone={tone} summary={summary} chips={chips} steps={steps}
      blurb="Connect this workspace to a GitHub organisation. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to GitHub."
    />
  );
}
