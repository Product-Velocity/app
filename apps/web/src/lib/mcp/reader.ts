import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VIEWS, VIEW_NAMES, type SearchNames, type SearchRow } from "@pv/domain";
import { SupabaseDataSource } from "@/features/portfolio/supabase-source";
import { shareUrl } from "@/lib/files/serve";
import { buildContext, type FileInfo, type ItemDetail, type McpReader, type Member, type ViewInfo, type WorkspaceContext } from "./read-model";

const FILE_CAP = 200;
type Err = { message?: string } | null;
const must = <T>(r: { data: T | null; error: Err }, what: string): T => {
  if (r.error) throw new Error(what);
  return (r.data ?? ([] as unknown)) as T;
};

/**
 * Reads the workspace for the MCP read tools. Everything runs on `supabase`, which carries the caller's own OAuth token, so
 * row-level security decides what is visible; the tenant filter is repeated on every query as the second check (CLAUDE.md rule 1).
 * Items load through the grid's own data source, which is what makes a search return the grid's set.
 */
export function makeReader(supabase: SupabaseClient, tenant: { id: string; name: string }, userId: string, role: string, appUrl: () => Promise<string>) {
  const ds = new SupabaseDataSource(supabase, tenant.id);
  const memo = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= fn());
  };

  const people = memo(async (): Promise<Member[]> => {
    const rows = must(await supabase.rpc("tenant_directory", { p_tenant: tenant.id }), "members") as { user_id: string; email: string; role: string }[];
    return rows.map((r) => ({ id: r.user_id, name: r.email, role: r.role }));
  });
  const projects = memo(async () =>
    must(await supabase.from("projects").select("id, name, default_repo, tracker").eq("tenant_id", tenant.id).order("name"), "projects") as { id: string; name: string; default_repo: string | null; tracker: string | null }[]);
  const teams = memo(async () => must(await supabase.from("teams").select("id, name").eq("tenant_id", tenant.id).order("name"), "teams") as { id: string; name: string }[]);
  const names = memo(async (): Promise<SearchNames> => {
    const [p, m] = await Promise.all([projects(), people()]);
    return { projects: p.map((x) => ({ id: x.id, name: x.name })), members: m.map((x) => ({ id: x.id, name: x.name })) };
  });
  const rows = memo(async (): Promise<SearchRow[]> => (await ds.loadItems()) as unknown as SearchRow[]);

  const findRow = async (ref: string): Promise<SearchRow | null> => {
    const all = await rows();
    const want = ref.trim().toLowerCase();
    return all.find((r) => r.id === ref.trim()) ?? all.find((r) => String(r.item_code).toLowerCase() === want) ?? null;
  };

  const fileInfo = async (list: { id: string; item_id: string; name: string; mime_type: string | null; size_bytes: number | null; share_token: string | null }[]): Promise<FileInfo[]> => {
    if (list.length === 0) return [];
    const [all, origin] = await Promise.all([rows(), appUrl()]);
    const code = new Map(all.map((r) => [r.id, String(r.item_code)]));
    return list.map((f) => ({
      id: f.id, item_code: code.get(f.item_id) ?? "", name: f.name, mime: f.mime_type, size: f.size_bytes,
      shared: Boolean(f.share_token), share_url: f.share_token ? shareUrl(origin, f.share_token, f.name) : null,
    }));
  };
  const FILE_COLS = "id, item_id, name, mime_type, size_bytes, share_token";

  const reader: McpReader = {
    async searchData() {
      const [r, n] = await Promise.all([rows(), names()]);
      return { rows: r, names: n, me: userId };
    },

    async itemDetail(ref): Promise<ItemDetail | null> {
      const row = await findRow(ref);
      if (!row) return null;
      const id = row.id;
      const all = await rows();
      const byId = new Map(all.map((r) => [r.id, { code: String(r.item_code), name: String(r.initiative_name) }]));
      const rel = (ids: string[]) => ids.map((i) => byId.get(i)).filter((x): x is { code: string; name: string } => Boolean(x));
      const [related, activity, files, link, back, teamList] = await Promise.all([
        ds.loadRelated(id),
        ds.loadActivity(id),
        supabase.from("item_files").select(FILE_COLS).eq("tenant_id", tenant.id).eq("item_id", id).order("created_at"),
        supabase.from("item_github_links").select("issue_number, html_url, mode, sync_state, last_error, gh_state, gh_last_activity").eq("tenant_id", tenant.id).eq("item_id", id).maybeSingle(),
        supabase.from("item_relations").select("item_id").eq("tenant_id", tenant.id).eq("related_item_id", id).eq("kind", "depends_on"),
        teams(),
      ]);
      const l = link.data as { issue_number: number | null; html_url: string | null; mode: string; sync_state: string; last_error: string | null; gh_state: string | null; gh_last_activity: string | null } | null;
      return {
        row,
        links: related.artifacts.map((a) => ({ label: a.label, url: a.url })),
        tags: { tags: related.tags, target_scope: related.target_scope, live_scope: related.live_scope, target_segments: related.target_segments },
        relations: {
          depends_on: rel(related.depends_on), related_to: rel(related.related_to),
          depended_on_by: rel(((back.data ?? []) as { item_id: string }[]).map((x) => x.item_id)),
        },
        teams: related.contributing_teams.map((t) => teamList.find((x) => x.id === t)?.name ?? "unknown team"),
        files: await fileInfo(must(files, "files") as never),
        github: l ? { issue_number: l.issue_number, url: l.html_url, mode: l.mode, state: l.sync_state, error: l.last_error, github_state: l.gh_state, last_activity: l.gh_last_activity } : null,
        activity: activity.slice(0, 10).map((a) => ({ at: a.at, field: a.field, old: a.old, new: a.new, by: a.actorId, via: a.via })),
      };
    },

    async groups() {
      const [list, all] = await Promise.all([supabase.from("item_groups").select("name").eq("tenant_id", tenant.id).order("name"), rows()]);
      const count = new Map<string, number>();
      for (const r of all) if (typeof r.theme === "string") count.set(r.theme, (count.get(r.theme) ?? 0) + 1);
      return (must(list, "groups") as { name: string }[]).map((g) => ({ name: g.name, items: count.get(g.name) ?? 0 }));
    },

    async views() {
      // RLS: workspace views for everyone, private views only for their owner
      const saved = must(
        await supabase.from("saved_views").select("id, name, columns, filters, group_by, sort, visibility, customer_safe, base_view").eq("tenant_id", tenant.id).order("name"),
        "views",
      ) as { id: string; name: string; columns: string[]; filters: unknown[]; group_by: string | null; sort: unknown; visibility: "workspace" | "private"; customer_safe: boolean; base_view: string | null }[];
      const customised = new Set(saved.map((v) => v.base_view).filter(Boolean));
      const builtIn: ViewInfo[] = VIEW_NAMES.filter((n) => !customised.has(n)).map((n) => ({ id: null, name: n, scope: "built-in", columns: DEFAULT_VIEWS[n], filters: [], group_by: null, sort: null, customer_safe: false }));
      const own: ViewInfo[] = saved.map((v) => ({
        id: v.id, name: v.name, scope: v.visibility, columns: v.columns, filters: v.filters, group_by: v.group_by, sort: v.sort, customer_safe: v.customer_safe,
        ...(v.base_view ? { customises: v.base_view } : {}),
      }));
      return [...builtIn, ...own];
    },

    async files(ref) {
      let q = supabase.from("item_files").select(FILE_COLS).eq("tenant_id", tenant.id).order("created_at").limit(FILE_CAP + 1);
      if (ref) {
        const row = await findRow(ref);
        if (!row) return null;
        q = q.eq("item_id", row.id);
      }
      const list = must(await q, "files") as never[];
      return { files: await fileInfo(list.slice(0, FILE_CAP)), truncated: list.length > FILE_CAP };
    },
  };

  const workspaceContext = async (): Promise<WorkspaceContext> => {
    const [p, t, m, g, conn, repos] = await Promise.all([
      projects(), teams(), people(),
      supabase.from("item_groups").select("name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("github_connections").select("id").eq("tenant_id", tenant.id).eq("state", "connected").maybeSingle(),
      supabase.from("github_repositories").select("full_name, is_private").eq("tenant_id", tenant.id).is("removed_at", null),
    ]);
    return buildContext({
      tenant, userId, role, projects: p, teams: t, members: m,
      groups: (must(g, "groups") as { name: string }[]).map((x) => x.name),
      githubConnected: Boolean(conn.data),
      repoPrivate: new Map(((repos.data ?? []) as { full_name: string; is_private: boolean | null }[]).filter((r) => r.is_private !== null).map((r) => [r.full_name.toLowerCase(), r.is_private as boolean])),
    });
  };

  return { reader, workspaceContext };
}
