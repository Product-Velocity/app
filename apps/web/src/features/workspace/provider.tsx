"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseWorkspaceStore, type Layouts, type Project, type SavedView, type Scope, type WorkspaceStore } from "./store";
import type { ViewName } from "@pv/domain";

export type WorkspaceProject = Project;
type Ctx = {
  store: WorkspaceStore;
  projects: WorkspaceProject[];
  scopes: Scope[];
  views: SavedView[];
  /** The Roadmap view bar: the workspace default and the signed-in person's own layout. */
  layouts: Layouts;
  /** The signed-in person (owner of their private views); null only before sign-in is known. */
  userId: string | null;
  /** Customised default views by name (the built-in view is used when a name is missing). */
  defaults: Partial<Record<ViewName, SavedView>>;
  /** True once scopes and views have been read (or failed). */
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
  canEdit: boolean;
  /** Admins can add projects. */
  canAdmin: boolean;
};
const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return c;
}

/** Holds the saved scopes and views of the workspace for the header and the grid. */
export function WorkspaceProvider({ store, projects: initialProjects, canEdit, canAdmin, userId = null, children }: { store: WorkspaceStore; projects: WorkspaceProject[]; canEdit: boolean; canAdmin: boolean; userId?: string | null; children: ReactNode }) {
  const [projects, setProjects] = useState<WorkspaceProject[]>(initialProjects);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [allViews, setAllViews] = useState<SavedView[]>([]);
  const views = useMemo(() => allViews.filter((v) => !v.baseView), [allViews]);
  const defaults = useMemo(() => Object.fromEntries(allViews.filter((v) => v.baseView).map((v) => [v.baseView!, v])) as Partial<Record<ViewName, SavedView>>, [allViews]);
  const [layouts, setLayouts] = useState<Layouts>({ workspace: [], mine: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v, p, l] = await Promise.all([store.listScopes(), store.listViews(), store.listProjects(), store.listLayouts()]);
      return { scopes: s, views: v, projects: p, layouts: l, error: null as string | null };
    } catch (e) {
      return { scopes: null, views: null, projects: null, layouts: null, error: e instanceof Error ? e.message : "Could not load scopes and views." };
    }
  }, [store]);
  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if (r.scopes) setScopes(r.scopes);
    if (r.views) setAllViews(r.views);
    if (r.layouts) setLayouts(r.layouts);
    if (r.projects && r.projects.length > 0) setProjects(r.projects);
    setError(r.error);
    setReady(true);
  }, []);
  const reload = useCallback(async () => apply(await load()), [apply, load]);

  useEffect(() => {
    let cancelled = false;
    void load().then((r) => { if (!cancelled) apply(r); });
    return () => { cancelled = true; };
  }, [load, apply]);

  const value = useMemo(() => ({ store, projects, scopes, views, layouts, userId, defaults, ready, error, reload, canEdit, canAdmin }), [store, projects, scopes, views, layouts, userId, defaults, ready, error, reload, canEdit, canAdmin]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** The provider the app uses: talks to Supabase as the signed-in person. */
export function SupabaseWorkspaceProvider({ tenantId, userId, projects, canEdit, canAdmin, children }: { tenantId: string; userId: string; projects: WorkspaceProject[]; canEdit: boolean; canAdmin: boolean; children: ReactNode }) {
  const store = useMemo(() => new SupabaseWorkspaceStore(createClient(), tenantId, userId), [tenantId, userId]);
  return <WorkspaceProvider store={store} projects={projects} canEdit={canEdit} canAdmin={canAdmin} userId={userId}>{children}</WorkspaceProvider>;
}
