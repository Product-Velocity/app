"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "./provider";

/** Which projects the roadmap shows: everything, a saved scope, or a single project. Kept in the address (?scope=). */
export type ScopeSelection = { kind: "all" } | { kind: "scope"; id: string } | { kind: "project"; id: string };

export function parseScope(param: string | null): ScopeSelection {
  if (!param || param === "all") return { kind: "all" };
  if (param.startsWith("p:")) return { kind: "project", id: param.slice(2) };
  return { kind: "scope", id: param };
}
export const scopeParam = (s: ScopeSelection): string | null => (s.kind === "all" ? null : s.kind === "project" ? `p:${s.id}` : s.id);

/** Change one query parameter without reloading the page or asking the server again. */
export function setQueryParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name); else url.searchParams.set(name, value);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const STORE_KEY = "pv.scope";
const readStored = (): string | null => { try { return window.localStorage.getItem(STORE_KEY); } catch { return null; } };
const writeStored = (v: string) => { try { window.localStorage.setItem(STORE_KEY, v); } catch { /* storage blocked: the address still carries it */ } };

export function useScope() {
  const params = useSearchParams();
  const { scopes, projects, ready } = useWorkspace();
  const urlParam = params.get("scope");
  const selection = useMemo(() => parseScope(urlParam), [urlParam]);

  // Other pages (links, tabs, settings) open without ?scope=: bring back the last choice so the project stays selected.
  useEffect(() => {
    if (urlParam !== null) { writeStored(urlParam); return; }
    const stored = readStored();
    if (stored && stored !== "all") setQueryParam("scope", stored);
  }, [urlParam]);

  const resolved = useMemo(() => {
    if (selection.kind === "project") {
      const p = projects.find((x) => x.id === selection.id);
      return p ? { label: p.name, projectIds: [p.id] as string[] | null } : { label: "All projects", projectIds: null };
    }
    if (selection.kind === "scope") {
      const s = scopes.find((x) => x.id === selection.id);
      if (s) return { label: s.name, projectIds: s.projectIds as string[] | null };
      // scopes are still loading: show nothing is filtered yet; a scope that was deleted falls back to everything
      return { label: ready ? "All projects" : "Loading…", projectIds: null };
    }
    return { label: "All projects", projectIds: null };
  }, [selection, scopes, projects, ready]);

  const select = useCallback((s: ScopeSelection) => { writeStored(scopeParam(s) ?? "all"); setQueryParam("scope", scopeParam(s)); }, []);
  return { selection, label: resolved.label, projectIds: resolved.projectIds, select };
}
