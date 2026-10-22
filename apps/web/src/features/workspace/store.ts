import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeView, type ViewDef } from "@pv/domain";

export type Scope = { id: string; name: string; projectIds: string[] };
export type SavedView = { id: string; name: string } & ViewDef;
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
}

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
    const { data, error } = await this.client.from("saved_views").select("id,name,columns,filters,group_by").eq("tenant_id", this.tenantId).order("name");
    if (error) throw new Error(friendly(error, "view"));
    return (data ?? []).map((r) => ({ id: r.id, name: r.name, ...sanitizeView({ columns: r.columns, filters: r.filters, groupBy: r.group_by }) }));
  }

  async createView(name: string, def: ViewDef): Promise<Result<SavedView>> {
    const n = validName(name, 80);
    if (!n) return { ok: false, error: "Give the view a name (up to 80 characters)." };
    const clean = sanitizeView(def);
    const { data, error } = await this.client
      .from("saved_views")
      .insert({ tenant_id: this.tenantId, name: n, columns: clean.columns, filters: clean.filters, group_by: clean.groupBy })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendly(error, "view", n) };
    return { ok: true, value: { id: data.id, name: n, ...clean } };
  }

  async updateView(id: string, patch: { name?: string } & Partial<ViewDef>): Promise<Result<SavedView>> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const n = validName(patch.name, 80);
      if (!n) return { ok: false, error: "Give the view a name (up to 80 characters)." };
      row.name = n;
    }
    if (patch.columns || patch.filters || patch.groupBy !== undefined) {
      const clean = sanitizeView({ columns: patch.columns, filters: patch.filters, groupBy: patch.groupBy ?? null });
      if (patch.columns) row.columns = clean.columns;
      if (patch.filters) row.filters = clean.filters;
      if (patch.groupBy !== undefined) row.group_by = clean.groupBy;
    }
    const { data, error } = await this.client
      .from("saved_views").update(row).eq("tenant_id", this.tenantId).eq("id", id).select("id,name,columns,filters,group_by");
    if (error) return { ok: false, error: friendly(error, "view", String(row.name ?? "")) };
    const r = data?.[0];
    if (!r) return { ok: false, error: "That view no longer exists or you cannot change it." };
    return { ok: true, value: { id: r.id, name: r.name, ...sanitizeView({ columns: r.columns, filters: r.filters, groupBy: r.group_by }) } };
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
    const v = { id: `view-${++this.n}`, name: nm, ...sanitizeView(def) };
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
    const clean = sanitizeView({ columns: patch.columns ?? v.columns, filters: patch.filters ?? v.filters, groupBy: patch.groupBy === undefined ? v.groupBy : patch.groupBy });
    v.columns = clean.columns; v.filters = clean.filters; v.groupBy = clean.groupBy;
    return { ok: true, value: { ...v } };
  }
  async deleteView(id: string): Promise<Result<null>> {
    const f = this.fail<null>(); if (f) return f;
    if (!this.views.some((x) => x.id === id)) return { ok: false, error: "That view no longer exists or you cannot delete it." };
    this.views = this.views.filter((x) => x.id !== id);
    return { ok: true, value: null };
  }
}
