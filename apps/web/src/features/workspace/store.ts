import type { SupabaseClient } from "@supabase/supabase-js";
import { BAR_FULL_MESSAGE, BAR_MAX, PRIVATE_VIEW_CAP, sanitizeView, type BuiltinBarName, type LayoutRow, type ViewDef, type ViewName } from "@pv/domain";

export type Scope = { id: string; name: string; projectIds: string[] };
/** `baseView` is set on a customised default view (it replaces the built-in view of that name until restored). */
export type SavedView = { id: string; name: string; baseView?: ViewName | null; /** null or missing = a workspace view (everyone reads it, admins write it); else the person who owns this private view. */ ownerId?: string | null } & ViewDef;
export type Layouts = { workspace: LayoutRow[]; mine: LayoutRow[] };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Saved scopes (which projects the roadmap shows) and saved views (columns, filters, grouping). */
export type Project = { id: string; name: string };

export interface WorkspaceStore {
  listProjects(): Promise<Project[]>;
  /** Admins only (the database refuses everyone else). */
  createProject(name: string): Promise<Result<Project>>;
  listScopes(): Promise<Scope[]>;
  createScope(name: string, projectIds: string[]): Promise<Result<Scope>>;
  updateScope(id: string, name: string, projectIds: string[]): Promise<Result<Scope>>;
  deleteScope(id: string): Promise<Result<null>>;
  /** The workspace views plus the signed-in person's own private views (the database never returns anyone else's). */
  listViews(): Promise<SavedView[]>;
  /** Private to the signed-in person unless `workspace` is set (admins only). */
  createView(name: string, def: ViewDef, opts?: { workspace?: boolean }): Promise<Result<SavedView>>;
  updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>>;
  deleteView(id: string): Promise<Result<null>>;
  /** Admins: publish their own private view to the workspace, or take a workspace view back to private. */
  setViewScope(id: string, workspace: boolean): Promise<Result<SavedView>>;
  /** The bar: the workspace default and the signed-in person's own layout. */
  listLayouts(): Promise<Layouts>;
  /** Replaces the whole layout in one step. An empty list removes it (the person follows the workspace again). */
  replaceLayout(workspace: boolean, rows: LayoutRow[]): Promise<Result<null>>;
  /** Customise a built-in default view for the whole workspace (creates or replaces the override). */
  saveDefaultView(name: ViewName, def: ViewDef): Promise<Result<SavedView>>;
  /** Back to the built-in default (deletes the override). */
  restoreDefaultView(name: ViewName): Promise<Result<null>>;
}

const VIEW_COLUMNS = "id,name,columns,filters,group_by,base_view,customer_safe,pinned,owner_id,sort";
type ViewRow = { id: string; name: string; columns: string[]; filters: unknown; group_by: string | null; base_view: string | null; customer_safe: boolean; pinned?: string[] | null; owner_id?: string | null; sort?: unknown };
const fromRow = (r: ViewRow): SavedView => ({
  id: r.id, name: r.name, baseView: (r.base_view as ViewName | null) ?? null, ownerId: r.owner_id ?? null,
  ...sanitizeView({ columns: r.columns, filters: r.filters, groupBy: r.group_by, customerSafe: r.customer_safe, pinned: r.pinned ?? [], sort: r.sort }),
});

type LayoutDbRow = { user_id: string | null; view_id: string | null; builtin: string | null; in_bar: boolean; position: number; hidden: boolean };
const layoutFromRow = (r: LayoutDbRow): LayoutRow => ({
  ref: r.view_id ? { kind: "saved", id: r.view_id } : { kind: "builtin", name: r.builtin as BuiltinBarName },
  inBar: r.in_bar, position: r.position, ...(r.hidden ? { hidden: true } : {}),
});
const layoutToJson = (r: LayoutRow, i: number) => ({
  view_id: r.ref.kind === "saved" ? r.ref.id : null, builtin: r.ref.kind === "builtin" ? r.ref.name : null,
  in_bar: r.inBar, position: i, hidden: r.hidden === true,
});

export const validName = (name: string, max: number) => {
  const n = name.trim();
  return n.length >= 1 && n.length <= max ? n : null;
};

type DbError = { code?: string; message?: string } | null;
function friendly(error: DbError, what: string, name?: string): string {
  switch (error?.code) {
    case "23505": return `There is already a ${what} called "${name ?? ""}".`;
    case "42501": return what === "view" || what === "layout" ? "Workspace views can only be changed by an admin. Save as your own view instead." : `You do not have permission to change ${what}s. Ask an admin for the Creator role.`;
    case "23514": return /at most 25|bar is full/i.test(error?.message ?? "") ? error!.message! : `That ${what} is not valid.`;
    case "23503": return "A project in that scope does not exist in this workspace.";
  }
  const m = error?.message ?? "";
  if (/failed to fetch|network|load failed/i.test(m)) return "Could not reach the server, check your connection.";
  return m || "Something went wrong.";
}

export class SupabaseWorkspaceStore implements WorkspaceStore {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string, private readonly userId: string | null = null) {}

  async listProjects(): Promise<Project[]> {
    const { data, error } = await this.client.from("projects").select("id,name").eq("tenant_id", this.tenantId).order("name");
    if (error) throw new Error(friendly(error, "project"));
    return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
  }

  async createProject(name: string): Promise<Result<Project>> {
    const n = validName(name, 120);
    if (!n) return { ok: false, error: "Give the project a name (up to 120 characters)." };
    const { data, error } = await this.client.from("projects").insert({ tenant_id: this.tenantId, name: n }).select("id,name").single();
    if (error || !data) {
      if (error?.code === "42501") return { ok: false, error: "Only admins can add projects." };
      return { ok: false, error: friendly(error, "project", n) };
    }
    return { ok: true, value: { id: data.id, name: data.name } };
  }

  async listScopes(): Promise<Scope[]> {
    const [s, l] = await Promise.all([
      this.client.from("saved_scopes").select("id,name").eq("tenant_id", this.tenantId).order("name"),
      this.client.from("saved_scope_projects").select("scope_id,project_id").eq("tenant_id", this.tenantId),
    ]);
    if (s.error) throw new Error(friendly(s.error, "scope"));
    if (l.error) throw new Error(friendly(l.error, "scope"));
    const byScope = new Map<string, string[]>();
    for (const x of l.data ?? []) byScope.set(x.scope_id, [...(byScope.get(x.scope_id) ?? []), x.project_id]);
    return (s.data ?? []).map((r) => ({ id: r.id, name: r.name, projectIds: byScope.get(r.id) ?? [] }));
  }

  private async setLinks(scopeId: string, projectIds: string[]): Promise<DbError> {
    const del = await this.client.from("saved_scope_projects").delete().eq("tenant_id", this.tenantId).eq("scope_id", scopeId);
    if (del.error) return del.error;
    if (projectIds.length === 0) return null;
    const ins = await this.client.from("saved_scope_projects").insert(projectIds.map((p) => ({ tenant_id: this.tenantId, scope_id: scopeId, project_id: p })));
    return ins.error;
  }

  async createScope(name: string, projectIds: string[]): Promise<Result<Scope>> {
    const n = validName(name, 120);
    if (!n) return { ok: false, error: "Give the scope a name (up to 120 characters)." };
    if (projectIds.length === 0) return { ok: false, error: "Choose at least one project." };
    const { data, error } = await this.client.from("saved_scopes").insert({ tenant_id: this.tenantId, name: n }).select("id").single();
    if (error || !data) return { ok: false, error: friendly(error, "scope", n) };
    const linkError = await this.setLinks(data.id, projectIds);
    if (linkError) {
      await this.client.from("saved_scopes").delete().eq("tenant_id", this.tenantId).eq("id", data.id); // do not leave an empty scope behind
      return { ok: false, error: friendly(linkError, "scope") };
    }
    return { ok: true, value: { id: data.id, name: n, projectIds } };
  }

  async updateScope(id: string, name: string, projectIds: string[]): Promise<Result<Scope>> {
    const n = validName(name, 120);
    if (!n) return { ok: false, error: "Give the scope a name (up to 120 characters)." };
    if (projectIds.length === 0) return { ok: false, error: "Choose at least one project." };
    const prev = await this.client.from("saved_scope_projects").select("project_id").eq("tenant_id", this.tenantId).eq("scope_id", id);
    const { data, error } = await this.client.from("saved_scopes").update({ name: n }).eq("tenant_id", this.tenantId).eq("id", id).select("id");
    if (error) return { ok: false, error: friendly(error, "scope", n) };
    if (!data || data.length === 0) return { ok: false, error: "That scope no longer exists or you cannot change it." };
    const linkError = await this.setLinks(id, projectIds);
    if (linkError) {
      await this.setLinks(id, (prev.data ?? []).map((r) => r.project_id)); // put the old projects back
      return { ok: false, error: friendly(linkError, "scope") };
    }
    return { ok: true, value: { id, name: n, projectIds } };
  }

  async deleteScope(id: string): Promise<Result<null>> {
    const { data, error } = await this.client.from("saved_scopes").delete().eq("tenant_id", this.tenantId).eq("id", id).select("id");
    if (error) return { ok: false, error: friendly(error, "scope") };
    return data && data.length > 0 ? { ok: true, value: null } : { ok: false, error: "That scope no longer exists or you cannot delete it." };
  }

  async listViews(): Promise<SavedView[]> {
    const { data, error } = await this.client.from("saved_views").select(VIEW_COLUMNS).eq("tenant_id", this.tenantId).order("name");
    if (error) throw new Error(friendly(error, "view"));
    return ((data ?? []) as ViewRow[]).map(fromRow);
  }

  async createView(name: string, def: ViewDef, opts: { workspace?: boolean } = {}): Promise<Result<SavedView>> {
    const n = validName(name, 80);
    if (!n) return { ok: false, error: "Give the view a name (up to 80 characters)." };
    const workspace = opts.workspace === true;
    if (!workspace && !this.userId) return { ok: false, error: "Sign in again to save a view." };
    const clean = sanitizeView(workspace ? def : { ...def, customerSafe: false });
    const { data, error } = await this.client
      .from("saved_views")
      .insert({
        tenant_id: this.tenantId, name: n, columns: clean.columns, filters: clean.filters, group_by: clean.groupBy, customer_safe: clean.customerSafe === true, pinned: clean.pinned ?? [], sort: clean.sort ?? null,
        ...(workspace ? { visibility: "workspace", owner_id: null } : { visibility: "private", owner_id: this.userId }),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendly(error, "view", n) };
    return { ok: true, value: { id: data.id, name: n, baseView: null, ownerId: workspace ? null : this.userId, ...clean } };
  }

  async setViewScope(id: string, workspace: boolean): Promise<Result<SavedView>> {
    if (!workspace && !this.userId) return { ok: false, error: "Sign in again to change this view." };
    const { data, error } = await this.client.from("saved_views")
      .update(workspace ? { visibility: "workspace", owner_id: null, customer_safe: false } : { visibility: "private", owner_id: this.userId, customer_safe: false })
      .eq("tenant_id", this.tenantId).eq("id", id).select(VIEW_COLUMNS);
    if (error) return { ok: false, error: friendly(error, "view") };
    const r = data?.[0];
    return r ? { ok: true, value: fromRow(r as ViewRow) } : { ok: false, error: "That view no longer exists or you cannot change it." };
  }

  async listLayouts(): Promise<Layouts> {
    const { data, error } = await this.client.from("view_layouts").select("user_id,view_id,builtin,in_bar,position,hidden").eq("tenant_id", this.tenantId).order("position");
    if (error) throw new Error(friendly(error, "layout"));
    const rows = (data ?? []) as LayoutDbRow[];
    return { workspace: rows.filter((r) => r.user_id === null).map(layoutFromRow), mine: rows.filter((r) => r.user_id !== null).map(layoutFromRow) };
  }

  async replaceLayout(workspace: boolean, rows: LayoutRow[]): Promise<Result<null>> {
    if (rows.filter((r) => r.inBar).length > BAR_MAX) return { ok: false, error: BAR_FULL_MESSAGE };
    const { error } = await this.client.rpc("replace_view_layout", { p_tenant: this.tenantId, p_workspace: workspace, p_rows: rows.map(layoutToJson) });
    return error ? { ok: false, error: friendly(error, "layout") } : { ok: true, value: null };
  }

  async saveDefaultView(name: ViewName, def: ViewDef): Promise<Result<SavedView>> {
    const clean = sanitizeView({ ...def, customerSafe: false });
    const existing = await this.client.from("saved_views").select("id").eq("tenant_id", this.tenantId).eq("base_view", name).maybeSingle();
    if (existing.error) return { ok: false, error: friendly(existing.error, "view", name) };
    const fields = { columns: clean.columns, filters: clean.filters, group_by: clean.groupBy, pinned: clean.pinned ?? [] };
    const { data, error } = existing.data
      ? await this.client.from("saved_views").update(fields).eq("tenant_id", this.tenantId).eq("id", existing.data.id).select(VIEW_COLUMNS)
      : await this.client.from("saved_views").insert({ tenant_id: this.tenantId, name, base_view: name, ...fields }).select(VIEW_COLUMNS);
    const r = (data as ViewRow[] | null)?.[0];
    if (error || !r) return { ok: false, error: error ? friendly(error, "view", name) : "You cannot change the default views. Ask an admin." };
    return { ok: true, value: fromRow(r) };
  }

  async restoreDefaultView(name: ViewName): Promise<Result<null>> {
    const { error } = await this.client.from("saved_views").delete().eq("tenant_id", this.tenantId).eq("base_view", name);
    return error ? { ok: false, error: friendly(error, "view", name) } : { ok: true, value: null };
  }

  async updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const n = validName(patch.name, 80);
      if (!n) return { ok: false, error: "Give the view a name (up to 80 characters)." };
      row.name = n;
    }
    if (patch.columns || patch.filters || patch.groupBy !== undefined || patch.pinned !== undefined || patch.sort !== undefined) {
      const clean = sanitizeView({ columns: patch.columns, filters: patch.filters, groupBy: patch.groupBy ?? null, customerSafe: patch.customerSafe, pinned: patch.pinned, sort: patch.sort });
      if (patch.sort !== undefined) row.sort = clean.sort ?? null;
      if (patch.columns || patch.pinned !== undefined) row.pinned = clean.pinned ?? [];
      if (patch.columns) row.columns = clean.columns;
      if (patch.filters) row.filters = clean.filters;
      if (patch.groupBy !== undefined) row.group_by = clean.groupBy;
      if (patch.customerSafe !== undefined) row.customer_safe = clean.customerSafe === true;
    }
    const { data, error } = await this.client
      .from("saved_views").update(row).eq("tenant_id", this.tenantId).eq("id", id).select(VIEW_COLUMNS);
    if (error) return { ok: false, error: friendly(error, "view", String(row.name ?? "")) };
    const r = data?.[0];
    if (!r) return { ok: false, error: "That view no longer exists or you cannot change it." };
    return { ok: true, value: fromRow(r as ViewRow) };
  }

  async deleteView(id: string): Promise<Result<null>> {
    const { data, error } = await this.client.from("saved_views").delete().eq("tenant_id", this.tenantId).eq("id", id).select("id");
    if (error) return { ok: false, error: friendly(error, "view") };
    return data && data.length > 0 ? { ok: true, value: null } : { ok: false, error: "That view no longer exists or you cannot delete it." };
  }
}

/** In-memory store for tests and the test page. */
export class MemoryWorkspaceStore implements WorkspaceStore {
  scopes: Scope[];
  views: SavedView[];
  /** Make the next write fail with this message. */
  failWith: string | null = null;
  private n = 0;
  /** Layout rows by person: "" is the workspace default. */
  layouts: Record<string, LayoutRow[]> = {};
  /** The signed-in person. Admins write workspace views; everyone writes their own private ones. */
  me = "me";
  constructor(init: { scopes?: Scope[]; views?: SavedView[]; me?: string; admin?: boolean } = {}) {
    this.scopes = init.scopes ? [...init.scopes] : [];
    this.views = init.views ? init.views.map((v) => ({ ...v, ownerId: v.ownerId ?? null })) : [];
    if (init.me) this.me = init.me;
    if (init.admin !== undefined) this.admin = init.admin;
  }
  /** What the database lets the person read: workspace views and their own private ones. */
  private visible() { return this.views.filter((v) => v.ownerId === null || v.ownerId === this.me); }
  private mayWrite(v: SavedView) { return v.ownerId === null ? this.admin : v.ownerId === this.me; }
  private fail<T>(): Result<T> | null { return this.failWith ? { ok: false, error: this.failWith } : null; }
  private dup(list: { id: string; name: string }[], name: string, what: string, except?: string): Result<never> | null {
    return list.some((x) => x.id !== except && x.name.trim().toLowerCase() === name.trim().toLowerCase()) ? { ok: false, error: `There is already a ${what} called "${name.trim()}".` } : null;
  }
  projects: Project[] = [];
  /** Set to false to make createProject refuse, as the database does for non-admins. */
  admin = true;
  /** Set to false to make writes to the default views refuse, as the database does for viewers. */
  canWrite = true;
  async listProjects() { return this.projects.map((p) => ({ ...p })); }
  async createProject(name: string): Promise<Result<Project>> {
    const f = this.fail<Project>(); if (f) return f;
    if (!this.admin) return { ok: false, error: "Only admins can add projects." };
    const nm = validName(name, 120); if (!nm) return { ok: false, error: "Give the project a name (up to 120 characters)." };
    const d = this.dup(this.projects, nm, "project"); if (d) return d;
    const p = { id: `project-${++this.n}`, name: nm };
    this.projects.push(p);
    return { ok: true, value: p };
  }
  async listScopes() { return this.scopes.map((s) => ({ ...s })); }
  async listViews() { return this.visible().map((v) => ({ ...v })); }
  async listLayouts(): Promise<Layouts> { return { workspace: [...(this.layouts[""] ?? [])], mine: [...(this.layouts[this.me] ?? [])] }; }
  async replaceLayout(workspace: boolean, rows: LayoutRow[]): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    if (workspace && !this.admin) return { ok: false, error: "You do not have permission to change layouts." };
    if (rows.filter((r) => r.inBar).length > BAR_MAX) return { ok: false, error: BAR_FULL_MESSAGE };
    this.layouts[workspace ? "" : this.me] = rows.map((r, i) => ({ ...r, position: i }));
    if (rows.length === 0) delete this.layouts[workspace ? "" : this.me];
    return { ok: true, value: null };
  }
  async createScope(name: string, projectIds: string[]): Promise<Result<Scope>> {
    const f = this.fail<Scope>(); if (f) return f;
    const nm = validName(name, 120); if (!nm) return { ok: false, error: "Give the scope a name (up to 120 characters)." };
    if (projectIds.length === 0) return { ok: false, error: "Choose at least one project." };
    const d = this.dup(this.scopes, nm, "scope"); if (d) return d;
    const s = { id: `scope-${++this.n}`, name: nm, projectIds: [...projectIds] };
    this.scopes.push(s);
    return { ok: true, value: s };
  }
  async updateScope(id: string, name: string, projectIds: string[]): Promise<Result<Scope>> {
    const f = this.fail<Scope>(); if (f) return f;
    const nm = validName(name, 120); if (!nm) return { ok: false, error: "Give the scope a name (up to 120 characters)." };
    if (projectIds.length === 0) return { ok: false, error: "Choose at least one project." };
    const d = this.dup(this.scopes, nm, "scope", id); if (d) return d;
    const s = this.scopes.find((x) => x.id === id); if (!s) return { ok: false, error: "That scope no longer exists or you cannot change it." };
    s.name = nm; s.projectIds = [...projectIds];
    return { ok: true, value: { ...s } };
  }
  async deleteScope(id: string): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    if (!this.scopes.some((x) => x.id === id)) return { ok: false, error: "That scope no longer exists or you cannot delete it." };
    this.scopes = this.scopes.filter((x) => x.id !== id);
    return { ok: true, value: null };
  }
  async createView(name: string, def: ViewDef, opts: { workspace?: boolean } = {}): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    const nm = validName(name, 80); if (!nm) return { ok: false, error: "Give the view a name (up to 80 characters)." };
    const workspace = opts.workspace === true;
    if (workspace && !this.admin) return { ok: false, error: "You do not have permission to change views." };
    const owner = workspace ? null : this.me;
    const d = this.dup(this.views.filter((v) => v.ownerId === owner), nm, "view"); if (d) return d;
    const capped = this.capProblem(owner); if (capped) return { ok: false, error: capped };
    const v: SavedView = { id: `view-${++this.n}`, name: nm, baseView: null, ownerId: owner, ...sanitizeView(workspace ? def : { ...def, customerSafe: false }) };
    this.views.push(v);
    return { ok: true, value: { ...v } };
  }
  private capProblem(owner: string | null): string | null {
    if (owner !== null) return this.views.filter((v) => v.ownerId === owner).length >= PRIVATE_VIEW_CAP ? "You can have at most 25 private views. Delete one first." : null;
    return this.views.filter((v) => v.ownerId === null && !v.baseView).length >= 14 ? "A workspace can have at most 25 views, including the 11 built-in ones. Delete or hide one first." : null;
  }
  async setViewScope(id: string, workspace: boolean): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    const v = this.visible().find((x) => x.id === id);
    if (!v || !this.mayWrite(v) || !this.admin) return { ok: false, error: "That view no longer exists or you cannot change it." };
    const owner = workspace ? null : this.me;
    const capped = this.capProblem(owner); if (capped) return { ok: false, error: capped };
    v.ownerId = owner; v.customerSafe = undefined;
    return { ok: true, value: { ...v } };
  }
  async updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    const v = this.visible().find((x) => x.id === id); if (!v || !this.mayWrite(v)) return { ok: false, error: "That view no longer exists or you cannot change it." };
    if (patch.name !== undefined) {
      const nm = validName(patch.name, 80); if (!nm) return { ok: false, error: "Give the view a name (up to 80 characters)." };
      const d = this.dup(this.views.filter((x) => x.ownerId === v.ownerId), nm, "view", id); if (d) return d;
      v.name = nm;
    }
    const clean = sanitizeView({ columns: patch.columns ?? v.columns, filters: patch.filters ?? v.filters, groupBy: patch.groupBy === undefined ? v.groupBy : patch.groupBy, customerSafe: patch.customerSafe ?? v.customerSafe, pinned: patch.pinned ?? v.pinned, sort: patch.sort === undefined ? v.sort : patch.sort });
    v.columns = clean.columns; v.filters = clean.filters; v.groupBy = clean.groupBy; v.pinned = clean.pinned; v.sort = clean.sort;
    if (patch.customerSafe !== undefined) v.customerSafe = clean.customerSafe;
    return { ok: true, value: { ...v } };
  }
  async deleteView(id: string): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    const v = this.visible().find((x) => x.id === id);
    if (!v || !this.mayWrite(v)) return { ok: false, error: "That view no longer exists or you cannot delete it." };
    this.views = this.views.filter((x) => x.id !== id);
    for (const k of Object.keys(this.layouts)) this.layouts[k] = this.layouts[k]!.filter((r) => !(r.ref.kind === "saved" && r.ref.id === id));
    return { ok: true, value: null };
  }
  async saveDefaultView(name: ViewName, def: ViewDef): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    if (!this.canWrite || !this.admin) return { ok: false, error: "You cannot change the default views. Ask an admin." };
    const clean = sanitizeView({ ...def, customerSafe: false });
    const existing = this.views.find((v) => v.baseView === name);
    if (existing) { Object.assign(existing, clean); existing.pinned = clean.pinned; return { ok: true, value: { ...existing } }; }
    const v: SavedView = { id: `view-${++this.n}`, name, baseView: name, ownerId: null, ...clean };
    this.views.push(v);
    return { ok: true, value: v };
  }
  async restoreDefaultView(name: ViewName): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    this.views = this.views.filter((v) => v.baseView !== name);
    return { ok: true, value: null };
  }
}
