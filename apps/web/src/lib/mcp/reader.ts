import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDigest, canEditItems, changeFlags, rowFlagTexts, type OutcomeReview, changesThisWeek, DEFAULT_VIEWS, digestMarkdown, healthByProject, needsAttention, OPEN_LIST_FIELDS, VIEW_NAMES, openListValues, summarizeProfile, weekWindow, type SearchNames, type SearchRow } from "@pv/domain";
import { SupabaseLeadershipStore } from "@/features/leadership/store";
import { SupabaseDataSource } from "@/features/portfolio/supabase-source";
import { addItemFile, removeItemFile, setFileSharing } from "@/lib/files/actions";
import { shareUrl } from "@/lib/files/serve";
import { supabaseFileStore, type FileStore } from "@/lib/files/store";
import { buildContext, type CompanyProfileData, type DocInfo, type GatePackData, type FileInfo, type ItemDetail, type McpReader, type Member, type OutcomeReviewInfo, type OutcomeReviewsInfo, type ViewInfo, type WorkspaceContext } from "./read-model";
import { ToolInputError } from "./tool-error";
import type { ApplyResult, McpDocuments, McpEpics, McpFiles, McpOutcomes, McpProfile, McpWriter, PendingRow, UndoResult } from "./write-model";

const FILE_CAP = 200;
/** The values in use of each open-list field (Focus Area, Audience): what Claude may reuse (issue #246). */
const openListsOf = (rows: readonly SearchRow[]): Record<string, string[]> => Object.fromEntries(OPEN_LIST_FIELDS.map((k) => [k, openListValues(rows.map((r) => r[k]))]));
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
export function makeReader(supabase: SupabaseClient, tenant: { id: string; name: string }, userId: string, role: string, appUrl: () => Promise<string>, store: () => FileStore = supabaseFileStore) {
  const ds = new SupabaseDataSource(supabase, tenant.id);
  const memo = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= fn());
  };

  // the person id of the signed-in user ("me" in a filter on a person field): it differs from the user id for someone named before they joined
  let mePerson: string | null = null;
  const people = memo(async (): Promise<Member[]> => {
    // who a person field can name: the members, and the people named without an account yet (issue #691; their role says so)
    const rows = must(await supabase.rpc("people_directory", { p_tenant: tenant.id }), "people") as { person_id: string; name: string; email: string | null; status: string; role: string | null; is_me?: boolean }[];
    mePerson = rows.find((r) => r.is_me)?.person_id ?? null;
    return rows.map((r) => ({ id: r.person_id, name: r.status === "active" ? r.email ?? r.name : r.name, role: r.role ?? (r.status === "invited" ? "invited, not a member yet" : "not invited yet") }));
  });
  const projects = memo(async () =>
    must(await supabase.from("projects").select("id, name, default_repo, tracker").eq("tenant_id", tenant.id).order("name"), "projects") as { id: string; name: string; default_repo: string | null; tracker: string | null }[]);
  const teams = memo(async () => must(await supabase.from("teams").select("id, name").eq("tenant_id", tenant.id).order("name"), "teams") as { id: string; name: string }[]);
  const names = memo(async (): Promise<SearchNames> => {
    const [p, m] = await Promise.all([projects(), people()]);
    return { projects: p.map((x) => ({ id: x.id, name: x.name })), members: m.map((x) => ({ id: x.id, name: x.name })) };
  });
  // The Flags and Actions columns are worked out, not stored (item-fields N50, N51): the grid derives them in the browser, so they are derived here too, from the same
  // rules, or Claude would read them as empty. Actions are only the words of the next step; Claude cannot click them.
  const rows = memo(async (): Promise<SearchRow[]> => {
    const [items, reviews] = await Promise.all([
      ds.loadItems(),
      supabase.from("outcome_reviews").select("item_id, at_days, due_on, requested_at, realised_kr_value, adoption_pct, notes, recorded_at").eq("tenant_id", tenant.id),
    ]);
    const outcomeReviews = reviews.error ? undefined : ((reviews.data ?? []) as OutcomeReview[]); // not read: no outcome flag rather than a wrong one
    const today = new Date(), canAct = canEditItems(role);
    for (const r of items) {
      const t = rowFlagTexts(r, today, canAct, outcomeReviews ? { outcomeReviews } : {});
      Object.assign(r, { flags: t.flags, actions: t.actions });
    }
    return items as unknown as SearchRow[];
  });

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

  const DOC_COLS = "id, item_id, kind, title, status, version, ai_draft, updated_at, approved_at, ai_tool, ai_model, body";
  type DocRow = { id: string; item_id: string; kind: string; title: string; status: string; version: number; ai_draft: boolean; updated_at: string; approved_at: string | null; ai_tool: string | null; ai_model: string | null; body: string };
  const docInfo = (d: DocRow, code: string, withBody = false): DocInfo => ({
    id: d.id, item_code: code, kind: d.kind, title: d.title, status: d.status, version: d.version, ai_draft: d.ai_draft,
    characters: d.body.length, updated_at: d.updated_at, approved_at: d.approved_at, ai_tool: d.ai_tool, ai_model: d.ai_model, ...(withBody ? { body: d.body } : {}),
  });
  const WS_DOC_COLS = "id, kind, title, status, version, ai_draft, updated_at, approved_at, ai_tool, ai_model, body";
  const wsInfo = (d: Omit<DocRow, "item_id">, withBody = false): DocInfo => ({ ...docInfo({ ...d, item_id: "" }, "", withBody), scope: "workspace" });
  const loadDoc = async (id: string, withBody: boolean): Promise<DocInfo | null> => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await supabase.from("item_documents").select(DOC_COLS).eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
    if (error) throw new Error("documents");
    if (data) {
      const d = data as DocRow;
      const code = String((await rows()).find((r) => r.id === d.item_id)?.item_code ?? "");
      return docInfo(d, code, withBody);
    }
    const ws = await supabase.from("workspace_documents").select(WS_DOC_COLS).eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
    if (ws.error) throw new Error("documents");
    return ws.data ? wsInfo(ws.data as Omit<DocRow, "item_id">, withBody) : null;
  };

  const PROFILE_COLS = "status, version, ai_draft, researched_at, confirmed_at, updated_at, sections";
  type ProfileRow = NonNullable<CompanyProfileData["profile"]>;
  const loadProfile = async (): Promise<CompanyProfileData> => {
    const [t, p] = await Promise.all([
      supabase.from("tenants").select("company_url").eq("id", tenant.id).maybeSingle(),
      supabase.from("company_profiles").select(PROFILE_COLS).eq("tenant_id", tenant.id).maybeSingle(),
    ]);
    if (t.error || p.error) throw new Error("company profile");
    return { url: (t.data as { company_url: string | null } | null)?.company_url ?? null, profile: (p.data as ProfileRow | null) ?? null };
  };

  const reader: McpReader = {
    async companyProfile() {
      return loadProfile();
    },
    async searchData() {
      const [r, n] = await Promise.all([rows(), names()]);
      return { rows: r, names: n, me: mePerson ?? userId };
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
        supabase.from("item_attachments").select(FILE_COLS).eq("kind", "file").eq("tenant_id", tenant.id).eq("item_id", id).order("created_at"),
        supabase.from("item_github_links").select("issue_number, html_url, mode, sync_state, last_error, gh_state, gh_last_activity").eq("tenant_id", tenant.id).eq("item_id", id).maybeSingle(),
        supabase.from("item_relations").select("item_id, kind").eq("tenant_id", tenant.id).eq("related_item_id", id).in("kind", ["depends_on", "related_to"]),
        teams(),
      ]);
      const backRows = (back.data ?? []) as { item_id: string; kind: "depends_on" | "related_to" }[];
      const l = link.data as { issue_number: number | null; html_url: string | null; mode: string; sync_state: string; last_error: string | null; gh_state: string | null; gh_last_activity: string | null } | null;
      return {
        row,
        links: related.artifacts.map((a) => ({ label: a.label, url: a.url, ...(a.shared === false ? { shared: false } : {}) })),
        tags: { tags: related.tags, target_scope: related.target_scope, live_scope: related.live_scope, target_segments: related.target_segments },
        relations: {
          depends_on: rel(related.depends_on),
          // related-to reads the same from both sides: what this one points to and what points to it
          related_to: rel([...new Set([...related.related_to, ...backRows.filter((x) => x.kind === "related_to").map((x) => x.item_id)])]),
          depended_on_by: rel(backRows.filter((x) => x.kind === "depends_on").map((x) => x.item_id)),
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
        await supabase.from("saved_views").select("id, name, columns, filters, group_by, then_by, show_issues, issue_types, issues_hide_done, sort, visibility, customer_safe, base_view").eq("tenant_id", tenant.id).eq("surface", "grid").order("name"), // the Grid's views; the Cards screen and the Gantt have their own
        "views",
      ) as { id: string; name: string; columns: string[]; filters: unknown[]; group_by: string | null; then_by: string | null; show_issues: boolean | null; issue_types: string[] | null; issues_hide_done: boolean | null; sort: unknown; visibility: "workspace" | "private"; customer_safe: boolean; base_view: string | null }[];
      const customised = new Set(saved.map((v) => v.base_view).filter(Boolean));
      const builtIn: ViewInfo[] = VIEW_NAMES.filter((n) => !customised.has(n)).map((n) => ({ id: null, name: n, scope: "built-in", columns: DEFAULT_VIEWS[n], filters: [], group_by: null, sort: null, customer_safe: false }));
      const own: ViewInfo[] = saved.map((v) => ({
        id: v.id, name: v.name, scope: v.visibility, columns: v.columns, filters: v.filters, group_by: v.group_by, ...(v.group_by && v.then_by ? { then_by: v.then_by } : {}), ...(v.show_issues ? { show_issues: true, ...(v.issue_types?.length ? { issue_types: v.issue_types } : {}), ...(v.issues_hide_done ? { issues_hide_done: true } : {}) } : {}), sort: v.sort, customer_safe: v.customer_safe,
        ...(v.base_view ? { customises: v.base_view } : {}),
      }));
      return [...builtIn, ...own];
    },

    async files(ref) {
      let q = supabase.from("item_attachments").select(FILE_COLS).eq("kind", "file").eq("tenant_id", tenant.id).order("created_at").limit(FILE_CAP + 1);
      if (ref) {
        const row = await findRow(ref);
        if (!row) return null;
        q = q.eq("item_id", row.id);
      }
      const list = must(await q, "files") as never[];
      return { files: await fileInfo(list.slice(0, FILE_CAP)), truncated: list.length > FILE_CAP };
    },

    async report(kind, weekOf, items) {
      const every = (await rows()) as { item_code?: unknown; [k: string]: unknown }[];
      // optional scope: only the initiatives the person named (codes, case does not matter); codes that do not exist are reported, never guessed
      const wanted = items && items.length > 0 ? new Set(items.map((c) => c.trim().toUpperCase()).filter(Boolean)) : null;
      const all = (wanted ? every.filter((r) => wanted.has(String(r.item_code).toUpperCase())) : every) as never[];
      const scope = wanted
        ? { all: false, items: all.map((r) => String((r as { item_code: unknown }).item_code)), not_found: [...wanted].filter((c) => !every.some((r) => String(r.item_code).toUpperCase() === c)) }
        : { all: true };
      // what a person needs to frame an initiative: where it is, how it is doing, its dates and what it serves (only fields the row has)
      const CONTEXT = ["item_code", "initiative_name", "initiative_phase", "initiative_status", "health", "status", "stack_rank", "g2m_date_est", "g2m_slip_days", "days_in_phase", "okr_objective", "theme", "kr_metric"] as const;
      const contextOf = (ids: readonly string[]) => all
        .filter((r) => ids.includes(String((r as { id: unknown }).id)))
        .slice(0, 25)
        .map((r) => Object.fromEntries(CONTEXT.filter((k) => (r as Record<string, unknown>)[k] !== undefined && (r as Record<string, unknown>)[k] !== null && (r as Record<string, unknown>)[k] !== "").map((k) => [k, (r as Record<string, unknown>)[k]])));
      const day = weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? new Date(`${weekOf}T12:00:00Z`) : new Date();
      const week = weekWindow(day);
      if (kind === "health") {
        const h = healthByProject(all, await projects());
        return {
          report: "health", scope, as_of: day.toISOString().slice(0, 10), initiatives: all.length,
          counts: h.totals.counts, summary: h.totals.summary,
          by_project: h.projects.map((p) => ({ project: p.name, initiatives: p.total, summary: p.summary })),
          needs_attention: needsAttention(all, day).slice(0, 25).map((a) => ({ item: a.code, name: a.name, health: a.health, reasons: a.reasons })),
        };
      }
      const store = new SupabaseLeadershipStore(supabase, tenant.id);
      const from = `${week.start}T00:00:00.000Z`, to = `${week.end}T00:00:00.000Z`;
      const [audit, feed, docs, origin] = await Promise.all([store.loadChanges(from), store.loadFeed(from, to), store.loadNewDocuments(from, to), appUrl()]);
      const trackers = await store.loadTrackers([...new Set(feed.map((r) => r.item_id))]);
      const itemHref = (code: string) => `${origin}/portfolio?item=${encodeURIComponent(code)}`;
      const digest = buildDigest({
        feed, rows: all, trackers, documents: docs, rankMoves: changesThisWeek(audit, all), flags: changeFlags(all, day), periodLabel: "this week", itemHref,
        documentHref: (code, d) => `${itemHref(code)}&tab=spec${d.entry === "document" ? `&doc=${encodeURIComponent(d.id)}` : ""}`, changesHref: `${origin}/reports?report=changes`, limit: 15,
      });
      return {
        report: "weekly_digest", scope, week: week.label, from: week.start, to_exclusive: week.end, headline: digest.headline,
        groups: digest.groups.map((g) => ({ id: g.id, title: g.title, lines: g.lines.length })),
        markdown: digestMarkdown(digest).join("\n"),
        // context for the initiatives the digest talks about (or, when a scope is named and the week was quiet, the named ones), so the summary can explain and not only list
        initiatives: contextOf(digest.itemIds.length > 0 ? digest.itemIds : all.map((r) => String((r as { id: unknown }).id))),
      };
    },

    async gatePack(ref): Promise<GatePackData | null> {
      const row = await findRow(ref);
      if (!row) return null;
      const [docs, reviews, conds] = await Promise.all([
        supabase.from("item_documents").select("kind, title, status, version").eq("tenant_id", tenant.id).eq("item_id", row.id).order("created_at"),
        supabase.from("gate_reviews").select("gate, kind, requested_at, outcome, rationale, fast_lane, decided_at, withdrawn_at, ready, criteria").eq("tenant_id", tenant.id).eq("item_id", row.id).order("requested_at", { ascending: false }).limit(20),
        supabase.from("gate_conditions").select("text, done_at").eq("tenant_id", tenant.id).eq("item_id", row.id).order("created_at"),
      ]);
      return {
        documents: must(docs, "documents") as GatePackData["documents"],
        requests: (must(reviews, "gate requests") as { gate: string; kind: string; requested_at: string; outcome: string | null; rationale: string | null; fast_lane: boolean; decided_at: string | null; withdrawn_at: string | null; ready: boolean; criteria: { label: string; ok: boolean }[] }[])
          .map(({ withdrawn_at, ...r }) => ({ ...r, withdrawn: Boolean(withdrawn_at) })),
        conditions: (must(conds, "gate conditions") as { text: string; done_at: string | null }[]).map((c) => ({ text: c.text, done: Boolean(c.done_at) })),
      };
    },

    async outcomeReviews(ref): Promise<OutcomeReviewsInfo | null> {
      const row = await findRow(ref);
      if (!row) return null;
      const [it, rv] = await Promise.all([
        supabase.from("items").select("item_code, initiative_name, start_rollout, kr_metric, kr_unit").eq("tenant_id", tenant.id).eq("id", row.id).maybeSingle(),
        supabase.from("outcome_reviews").select("at_days, due_on, requested_at, recorded_at, realised_kr_value, adoption_pct, notes, stated_words").eq("tenant_id", tenant.id).eq("item_id", row.id),
      ]);
      if (it.error || !it.data) return null;
      if (rv.error) throw new ToolInputError("The outcome reviews could not be read.");
      const i = it.data as { item_code: string; initiative_name: string; start_rollout: string | null; kr_metric: string | null; kr_unit: string | null };
      const have = new Map(((rv.data ?? []) as { at_days: number; due_on: string; requested_at: string | null; recorded_at: string | null; realised_kr_value: string | number | null; adoption_pct: string | number | null; notes: string | null; stated_words: string | null }[]).map((r) => [r.at_days, r]));
      const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
      const reviews = ([30, 60, 90] as const).map((days): OutcomeReviewInfo => {
        const r = have.get(days);
        const due = r?.due_on ?? (i.start_rollout ? new Date(Date.parse(`${i.start_rollout.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) : null);
        return {
          at_days: days, due_on: due, state: r?.recorded_at ? "recorded" : r?.requested_at ? "requested" : "not_requested",
          requested_at: r?.requested_at ?? null, recorded_at: r?.recorded_at ?? null, realised_kr_value: num(r?.realised_kr_value), adoption_pct: num(r?.adoption_pct), note: r?.notes ?? null, stated_words: r?.stated_words ?? null,
        };
      });
      return { item: i.item_code, name: i.initiative_name, start_rollout: i.start_rollout, kr_metric: i.kr_metric, kr_unit: i.kr_unit, reviews };
    },

    async documents(ref) {
      if (ref === null) {
        const list = must(await supabase.from("workspace_documents").select(WS_DOC_COLS).eq("tenant_id", tenant.id).order("updated_at", { ascending: false }).limit(200), "documents") as Omit<DocRow, "item_id">[];
        return list.map((d) => wsInfo(d));
      }
      const row = await findRow(ref);
      if (!row) return null;
      const list = must(await supabase.from("item_documents").select(DOC_COLS).eq("tenant_id", tenant.id).eq("item_id", row.id).order("created_at"), "documents") as DocRow[];
      return list.map((d) => docInfo(d, String(row.item_code)));
    },

    async document(id) {
      return loadDoc(id, true);
    },
  };

  const groupNames = memo(async () => (must(await supabase.from("item_groups").select("name").eq("tenant_id", tenant.id).order("name"), "groups") as { name: string }[]).map((g) => g.name));

  /** A refusal worth showing (PV005 are our own sentences; 42501 is the database saying no) becomes a message for Claude. */
  const refusal = (e: { code?: string; message?: string }): never => {
    if (e.code === "PV005" && e.message) throw new ToolInputError(e.message);
    if (e.code === "42501") throw new ToolInputError("The database refused this: your role or this connection may not write here. Check get_workspace_context for what Claude may do.");
    throw new Error("write");
  };

    /** Files: the same functions as the item panel (`lib/files/actions`), called with the caller's own client. */
  const asRefusal = (r: { error: string }): never => {
    throw new ToolInputError(r.error);
  };
  const files: McpFiles = {
    async get(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await supabase.from("item_attachments").select("id, item_id, name, share_token").eq("kind", "file").eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
      if (error) throw new Error("files");
      if (!data) return null;
      const f = data as { id: string; item_id: string; name: string; share_token: string | null };
      const code = String((await rows()).find((r) => r.id === f.item_id)?.item_code ?? "");
      return { ...f, item_code: code };
    },
    async add(item, name, bytes, mime) {
      const r = await addItemFile(supabase, store(), { itemId: item.id, name, bytes, declaredType: mime });
      if (!r.ok) return asRefusal(r);
      const [info] = await fileInfo([{ ...r.row, item_id: item.id } as never]);
      return { ...info!, item_code: item.code };
    },
    async setSharing(file, on) {
      const r = await setFileSharing(supabase, file.id, on);
      if (!r.ok) return asRefusal(r);
      return r.token ? shareUrl(await appUrl(), r.token, r.name) : null;
    },
    async remove(file) {
      const r = await removeItemFile(supabase, store(), file.id);
      if (!r.ok) asRefusal(r);
    },
    async repoFor(itemId) {
      const [link, row] = await Promise.all([
        supabase.from("item_github_links").select("repo_full_name").eq("tenant_id", tenant.id).eq("item_id", itemId).maybeSingle(),
        rows().then((all) => all.find((r) => r.id === itemId)),
      ]);
      let name = (link.data as { repo_full_name: string } | null)?.repo_full_name ?? null;
      if (!name && row?.home_project) name = (await projects()).find((p) => p.id === row.home_project)?.default_repo ?? null;
      if (!name) return { name: null, isPrivate: null };
      const { data } = await supabase.from("github_repositories").select("is_private").eq("tenant_id", tenant.id).ilike("full_name", name).is("removed_at", null).maybeSingle();
      return { name, isPrivate: (data as { is_private: boolean | null } | null)?.is_private ?? null };
    },
  };
  const documents: McpDocuments = {
    async create(item, doc) {
      if (item === null) {
        const { data, error } = await supabase.from("workspace_documents").insert({ tenant_id: tenant.id, kind: doc.kind, title: doc.title, body: doc.body, ai_model: doc.ai_model ?? null, ...(doc.status ? { status: doc.status } : {}) }).select(WS_DOC_COLS).single();
        if (error) return refusal(error);
        return wsInfo(data as Omit<DocRow, "item_id">);
      }
      const { data, error } = await supabase.from("item_documents").insert({ tenant_id: tenant.id, item_id: item.id, kind: doc.kind, title: doc.title, body: doc.body, ai_model: doc.ai_model ?? null, ...(doc.status ? { status: doc.status } : {}) }).select(DOC_COLS).single();
      if (error) return refusal(error);
      return docInfo(data as DocRow, item.code);
    },
    async update(id, expectedVersion, patch) {
      const isWorkspace = /^[0-9a-f-]{36}$/i.test(id) && (await loadDoc(id, false))?.scope === "workspace";
      if (isWorkspace) {
        const { data, error } = await supabase.from("workspace_documents").update({ ...patch, ...(patch.ai_model === undefined && (patch.body !== undefined || patch.title !== undefined) ? { ai_model: null } : {}) }).eq("tenant_id", tenant.id).eq("id", id).eq("version", expectedVersion).select(WS_DOC_COLS);
        if (error) return refusal(error);
        const back = (data ?? []) as Omit<DocRow, "item_id">[];
        if (back[0]) return { ok: true, doc: wsInfo(back[0]) };
        const now = await loadDoc(id, true);
        return now ? { ok: false, reason: "conflict", current: now } : { ok: false, reason: "missing" };
      }
      // an assistant that rewrites the text states its own model (or none); a change that leaves the text alone leaves the model alone (the database decides)
      const { data, error } = await supabase.from("item_documents").update({ ...patch, ...(patch.ai_model === undefined && (patch.body !== undefined || patch.title !== undefined) ? { ai_model: null } : {}) }).eq("tenant_id", tenant.id).eq("id", id).eq("version", expectedVersion).select(DOC_COLS);
      if (error) return refusal(error);
      const rowsBack = (data ?? []) as DocRow[];
      const code = async (itemId: string) => String((await rows()).find((r) => r.id === itemId)?.item_code ?? "");
      if (rowsBack[0]) return { ok: true, doc: docInfo(rowsBack[0], await code(rowsBack[0].item_id)) };
      const now = await loadDoc(id, true);
      return now ? { ok: false, reason: "conflict", current: now } : { ok: false, reason: "missing" };
    },
  };
  /** Our own sentences (PV004: the guard says who may confirm or change a confirmed profile) are shown to Claude; anything else is a generic refusal. */
  const profileRefusal = (e: { code?: string; message?: string }): never => {
    if (e.code === "PV004" && e.message) throw new ToolInputError(e.message);
    if (e.code === "23505") throw new ToolInputError("A company profile already exists. Read it with get_company_profile and update it with its version.");
    return refusal(e);
  };
  const profile: McpProfile = {
    async create(sections, researched) {
      const { data, error } = await supabase.from("company_profiles").insert({ tenant_id: tenant.id, sections, ...(researched ? { researched_at: new Date().toISOString() } : {}) }).select(PROFILE_COLS).single();
      if (error) return profileRefusal(error);
      return data as ProfileRow;
    },
    async update(expectedVersion, sections, researched) {
      const { data, error } = await supabase.from("company_profiles").update({ sections, ...(researched ? { researched_at: new Date().toISOString() } : {}) }).eq("tenant_id", tenant.id).eq("version", expectedVersion).select(PROFILE_COLS);
      if (error) return profileRefusal(error);
      const back = (data ?? []) as ProfileRow[];
      if (back[0]) return { ok: true, profile: back[0] };
      return { ok: false, reason: "conflict", current: (await loadProfile()).profile };
    },
  };
  const epics: McpEpics = {
    async request(itemId, keys) {
      const { data, error } = await supabase.rpc("item_request_jira_epics", { p_item: itemId, p_keys: keys });
      if (error) throw new ToolInputError(error.message && !/^(PGRST|JWT)/.test(error.message) ? error.message : "The epics could not be recorded.");
      const cur = await supabase.from("item_jira_epic_requests").select("epic_key, state, last_error").eq("tenant_id", tenant.id).eq("item_id", itemId).order("epic_key");
      const current = ((cur.data ?? []) as { epic_key: string; state: string; last_error: string | null }[]).map((r) => ({ key: r.epic_key, state: r.state, last_error: r.last_error }));
      return { added: (data ?? []) as string[], current };
    },
  };
  const outcomes: McpOutcomes = {
    async record(itemId, days, v) {
      const { error } = await supabase.rpc("record_outcome_review_as_claude", { p_item: itemId, p_at_days: days, p_value: v.value, p_adoption: v.adoption, p_note: v.note, p_words: v.words });
      if (error) throw new ToolInputError(error.message && !/^(PGRST|JWT)/.test(error.message) ? error.message : "The metrics could not be recorded.");
    },
  };
  const writer: McpWriter = {
    files,
    epics,
    outcomes,
    documents,
    profile,
    async context(r) {
      const [p, m, g, t, all] = await Promise.all([projects(), people(), groupNames(), teams(), rows()]);
      return {
        role: r,
        projects: p.map((x) => ({ id: x.id, name: x.name })),
        members: m.map((x) => ({ id: x.id, name: x.name })),
        groups: g, teams: t.map((x) => ({ id: x.id, name: x.name })),
        items: all.map((x) => ({ id: x.id, code: String(x.item_code) })),
        openLists: openListsOf(all),
        today: new Date(),
      };
    },

    async current(ref) {
      const row = await findRow(ref);
      if (!row) return null;
      const [tagRows, teamRows] = await Promise.all([
        supabase.from("item_tags").select("kind, value").eq("tenant_id", tenant.id).eq("item_id", row.id),
        supabase.from("item_teams").select("team_id").eq("tenant_id", tenant.id).eq("item_id", row.id),
      ]);
      const lists: Record<string, string[]> = { tags: [], target_scope: [], live_scope: [], target_segments: [], contributing_teams: [] };
      const KIND: Record<string, string> = { tag: "tags", target_scope: "target_scope", live_scope: "live_scope", segment: "target_segments" };
      for (const t of must(tagRows, "tags") as { kind: string; value: string }[]) lists[KIND[t.kind]!]?.push(t.value);
      for (const t of must(teamRows, "teams") as { team_id: string }[]) lists.contributing_teams!.push(t.team_id);
      return { id: row.id, code: String(row.item_code), current: row as Record<string, unknown>, lists };
    },

    async apply(tool, units, opts = {}) {
      const { data, error } = await supabase.rpc("mcp_apply", { p_tool: tool, p_units: units, p_all_or_nothing: opts.allOrNothing ?? false, p_pending: opts.pending ?? null, p_tenant: tenant.id });
      if (error) return refusal(error);
      return data as ApplyResult;
    },

    async savePending(diff, changes) {
      const { data, error } = await supabase.rpc("mcp_pending_save", { p_diff: diff, p_units: changes, p_tenant: tenant.id });
      if (error) return refusal(error);
      const r = (data as { id: string; expires_at: string }[])[0];
      if (!r) throw new Error("pending");
      return r;
    },

    async loadPending(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await supabase.from("mcp_pending_changes").select("id, units, expires_at, applied_at").eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
      if (error) throw new Error("pending");
      const r = data as { id: string; units: PendingRow["changes"]; expires_at: string; applied_at: string | null } | null;
      return r ? { id: r.id, changes: r.units, expires_at: r.expires_at, applied_at: r.applied_at } : null;
    },

    async undo() {
      const { data, error } = await supabase.rpc("mcp_undo_last", { p_tenant: tenant.id });
      if (error) return refusal(error);
      return data as UndoResult;
    },
  };

  const workspaceContext = async (): Promise<WorkspaceContext> => {
    const [p, t, m, g, conn, repos, company] = await Promise.all([
      projects(), teams(), people(),
      supabase.from("item_groups").select("name").eq("tenant_id", tenant.id).order("name"),
      supabase.from("github_connections").select("id").eq("tenant_id", tenant.id).eq("state", "connected").maybeSingle(),
      supabase.from("github_repositories").select("full_name, is_private").eq("tenant_id", tenant.id).is("removed_at", null),
      loadProfile(),
    ]);
    return buildContext({
      tenant, userId, role, projects: p, teams: t, members: m,
      groups: (must(g, "groups") as { name: string }[]).map((x) => x.name),
      openLists: openListsOf(await rows()),
      company: { url: company.url, profile: summarizeProfile(company.profile) },
      githubConnected: Boolean(conn.data),
      repoPrivate: new Map(((repos.data ?? []) as { full_name: string; is_private: boolean | null }[]).filter((r) => r.is_private !== null).map((r) => [r.full_name.toLowerCase(), r.is_private as boolean])),
    });
  };

  return { reader, writer, workspaceContext };
}
