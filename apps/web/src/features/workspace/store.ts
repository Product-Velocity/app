import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeView, type ViewDef, type ViewName } from "@pv/domain";

export type Scope = { id: string; name: string; projectIds: string[] };
/** `baseView` is set on a customised default view (it replaces the built-in view of that name until restored). */
export type SavedView = { id: string; name: string; baseView?: ViewName | null } & ViewDef;
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
  listViews(): Promise<SavedView[]>;
  createView(name: string, def: ViewDef): Promise<Result<SavedView>>;
  updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>>;
  deleteView(id: string): Promise<Result<null>>;
  /** Customise a built-in default view for the whole workspace (creates or replaces the override). */
  saveDefaultView(name: ViewName, def: ViewDef): Promise<Result<SavedView>>;
  /** Back to the built-in default (deletes the override). */
  restoreDefaultView(name: ViewName): Promise<Result<null>>;
}

const VIEW_COLUMNS = "id,name,columns,filters,group_by,base_view,customer_safe,pinned";
type ViewRow = { id: string; name: string; columns: string[]; filters: unknown; group_by: string | null; base_view: string | null; customer_safe: boolean; pinned?: string[] | null };
const fromRow = (r: ViewRow): SavedView => ({
  id: r.id, name: r.name, baseView: (r.base_view as ViewName | null) ?? null,
  ...sanitizeView({ columns: r.columns, filters: r.filters, groupBy: r.group_by, customerSafe: r.customer_safe, pinned: r.pinned ?? [] }),
});

export const validName = (name: string, max: number) => {
  const n = name.trim();
  return n.length >= 1 && n.length <= max ? n : null;
};

type DbError = { code?: string; message?: string } | null;
function friendly(error: DbError, what: string, name?: string): string {
  switch (error?.code) {
    case "23505": return `There is already a ${what} called "${name ?? ""}".`;
    case "42501": return `You do not have permission to change ${what}s. Ask an admin for the Creator role.`;
    case "23514": return `That ${what} is not valid.`;
    case "23503": return "A project in that scope does not exist in this workspace.";
  }
  const m = error?.message ?? "";
  if (/failed to fetch|network|load failed/i.test(m)) return "Could not reach the server, check your connection.";
  return m || "Something went wrong.";
}

export class SupabaseWorkspaceStore implements WorkspaceStore {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

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

  async createView(name: string, def: ViewDef): Promise<Result<SavedView>> {
    const n = validName(name, 80);
    if (!n) return { ok: false, error: "Give the view a name (up to 80 characters)." };
    const clean = sanitizeView(def);
    const { data, error } = await this.client
      .from("saved_views")
      .insert({ tenant_id: this.tenantId, name: n, columns: clean.columns, filters: clean.filters, group_by: clean.groupBy, customer_safe: clean.customerSafe === true, pinned: clean.pinned ?? [] })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendly(error, "view", n) };
    return { ok: true, value: { id: data.id, name: n, baseView: null, ...clean } };
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
    if (error || !r) return { ok: false, error: error ? friendly(error, "view", name) : "You cannot change the default views. Ask an admin for the Creator role." };
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
    if (patch.columns || patch.filters || patch.groupBy !== undefined || patch.pinned !== undefined) {
      const clean = sanitizeView({ columns: patch.columns, filters: patch.filters, groupBy: patch.groupBy ?? null, customerSafe: patch.customerSafe, pinned: patch.pinned });
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
  constructor(init: { scopes?: Scope[]; views?: SavedView[] } = {}) {
    this.scopes = init.scopes ? [...init.scopes] : [];
    this.views = init.views ? [...init.views] : [];
  }
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
  async listViews() { return this.views.map((v) => ({ ...v })); }
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
  async createView(name: string, def: ViewDef): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    const nm = validName(name, 80); if (!nm) return { ok: false, error: "Give the view a name (up to 80 characters)." };
    const d = this.dup(this.views, nm, "view"); if (d) return d;
    const v = { id: `view-${++this.n}`, name: nm, baseView: null, ...sanitizeView(def) };
    this.views.push(v);
    return { ok: true, value: v };
  }
  async updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    const v = this.views.find((x) => x.id === id); if (!v) return { ok: false, error: "That view no longer exists or you cannot change it." };
    if (patch.name !== undefined) {
      const nm = validName(patch.name, 80); if (!nm) return { ok: false, error: "Give the view a name (up to 80 characters)." };
      const d = this.dup(this.views, nm, "view", id); if (d) return d;
      v.name = nm;
    }
    const clean = sanitizeView({ columns: patch.columns ?? v.columns, filters: patch.filters ?? v.filters, groupBy: patch.groupBy === undefined ? v.groupBy : patch.groupBy, customerSafe: patch.customerSafe ?? v.customerSafe, pinned: patch.pinned ?? v.pinned });
    v.columns = clean.columns; v.filters = clean.filters; v.groupBy = clean.groupBy; v.pinned = clean.pinned;
    if (patch.customerSafe !== undefined) v.customerSafe = clean.customerSafe;
    return { ok: true, value: { ...v } };
  }
  async deleteView(id: string): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    if (!this.views.some((x) => x.id === id)) return { ok: false, error: "That view no longer exists or you cannot delete it." };
    this.views = this.views.filter((x) => x.id !== id);
    return { ok: true, value: null };
  }
  async saveDefaultView(name: ViewName, def: ViewDef): Promise<Result<SavedView>> {
    const f = this.fail<SavedView>(); if (f) return f;
    if (!this.canWrite) return { ok: false, error: "You cannot change the default views. Ask an admin for the Creator role." };
    const clean = sanitizeView({ ...def, customerSafe: false });
    const existing = this.views.find((v) => v.baseView === name);
    if (existing) { Object.assign(existing, clean); existing.pinned = clean.pinned; return { ok: true, value: { ...existing } }; }
    const v: SavedView = { id: `view-${++this.n}`, name, baseView: name, ...clean };
    this.views.push(v);
    return { ok: true, value: v };
  }
  async restoreDefaultView(name: ViewName): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    this.views = this.views.filter((v) => v.baseView !== name);
    return { ok: true, value: null };
  }
}
