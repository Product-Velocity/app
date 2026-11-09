"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseWorkspaceStore, type Layouts, type Project, type SavedView, type Scope, type WorkspaceStore } from "./store";
import { VIEW_SURFACES, type ViewName, type ViewSurface } from "@pv/domain";

export type WorkspaceProject = Project;
/** What one screen sees: its own views, customised defaults and view bar (the Grid and the Cards screen do not share them). */
type SurfaceCtx = {
  views: SavedView[];
  /** The view bar of this screen: the workspace default and the signed-in person's own layout. */
  layouts: Layouts;
  /** Customised default views by name (the built-in view is used when a name is missing). */
  defaults: Partial<Record<ViewName, SavedView>>;
};
type SharedCtx = {
  store: WorkspaceStore;
  projects: WorkspaceProject[];
  scopes: Scope[];
  /** The signed-in person (owner of their private views); null only before sign-in is known. */
  userId: string | null;
  /** True once scopes and views have been read (or failed). */
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
  canEdit: boolean;
  /** Admins can add projects. */
  canAdmin: boolean;
};
type Ctx = SharedCtx & SurfaceCtx;
type RawCtx = SharedCtx & { allViews: SavedView[]; layoutsBy: Record<ViewSurface, Layouts> };
const WorkspaceContext = createContext<RawCtx | null>(null);

/**
 * The workspace for one screen. The Grid (the default) and the Cards screen each have their own saved views, customised
 * default views and view bar: pass "cards" on the Cards screen. Scopes, projects and permissions are shared.
 */
export function useWorkspace(surface: ViewSurface = "grid"): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return useMemo(() => {
    const { allViews, layoutsBy, ...rest } = c;
    const here = allViews.filter((v) => (v.surface ?? "grid") === surface);
    const defaults = Object.fromEntries(here.filter((v) => v.baseView).map((v) => [v.baseView!, v])) as Partial<Record<ViewName, SavedView>>;
    return { ...rest, views: here.filter((v) => !v.baseView), defaults, layouts: layoutsBy[surface] };
  }, [c, surface]);
}

/** Holds the saved scopes and views of the workspace for the header and the grid. */
export function WorkspaceProvider({ store, projects: initialProjects, canEdit, canAdmin, userId = null, children }: { store: WorkspaceStore; projects: WorkspaceProject[]; canEdit: boolean; canAdmin: boolean; userId?: string | null; children: ReactNode }) {
  const [projects, setProjects] = useState<WorkspaceProject[]>(initialProjects);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [allViews, setAllViews] = useState<SavedView[]>([]);
  const [layoutsBy, setLayoutsBy] = useState<Record<ViewSurface, Layouts>>({ grid: { workspace: [], mine: [] }, cards: { workspace: [], mine: [] } });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v, p, l] = await Promise.all([store.listScopes(), store.listViews(), store.listProjects(), Promise.all(VIEW_SURFACES.map((x) => store.listLayouts(x)))]);
      return { scopes: s, views: v, projects: p, layouts: Object.fromEntries(VIEW_SURFACES.map((x, i) => [x, l[i]!])) as Record<ViewSurface, Layouts>, error: null as string | null };
    } catch (e) {
      return { scopes: null, views: null, projects: null, layouts: null, error: e instanceof Error ? e.message : "Could not load scopes and views." };
    }
  }, [store]);
  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if (r.scopes) setScopes(r.scopes);
    if (r.views) setAllViews(r.views);
    if (r.layouts) setLayoutsBy(r.layouts);
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

  const value = useMemo(() => ({ store, projects, scopes, allViews, layoutsBy, userId, ready, error, reload, canEdit, canAdmin }), [store, projects, scopes, allViews, layoutsBy, userId, ready, error, reload, canEdit, canAdmin]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** The provider the app uses: talks to Supabase as the signed-in person. */
export function SupabaseWorkspaceProvider({ tenantId, userId, projects, canEdit, canAdmin, children }: { tenantId: string; userId: string; projects: WorkspaceProject[]; canEdit: boolean; canAdmin: boolean; children: ReactNode }) {
  const store = useMemo(() => new SupabaseWorkspaceStore(createClient(), tenantId, userId), [tenantId, userId]);
  return <WorkspaceProvider store={store} projects={projects} canEdit={canEdit} canAdmin={canAdmin} userId={userId}>{children}</WorkspaceProvider>;
}
