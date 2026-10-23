"use client";

import { useRef, useState } from "react";
import { filterOptions, needsSearch } from "@pv/domain";
import { menuSearchKeys, NoResults, SearchInput } from "@/components/search-list";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./provider";
import { ProjectDialog, ScopeDialog } from "./scope-dialog";
import { useMenuBlur } from "../portfolio/use-menu-blur";
import { useDismiss } from "../portfolio/use-dismiss";
import { useScope } from "./scope";
import type { Scope } from "./store";

/** Header chip: "All projects ▾". Choose everything, a saved scope or one project; make or edit a scope. */
export function ScopeSwitcher() {
  const { scopes, projects, canEdit, canAdmin, error } = useWorkspace();
  const router = useRouter();
  const { selection, label, select } = useScope();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ scope: Scope | null } | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
  const close = (refocus = false) => { setOpen(false); if (refocus) ref.current?.querySelector<HTMLElement>(".scope-chip")?.focus(); };
  const pick = (s: Parameters<typeof select>[0]) => { select(s); close(true); };
  // a search box once the menu lists more than 8 entries (All projects, the scopes and the projects)
  const searchable = needsSearch(1 + scopes.length + projects.length);
  const showAll = filterOptions([{ label: "All projects" }], query).length > 0;
  const shownScopes = filterOptions(scopes.map((s) => ({ s, label: s.name })), query).map((x) => x.s);
  const shownProjects = filterOptions(projects.map((p) => ({ p, label: p.name })), query).map((x) => x.p);
  const nothing = !showAll && shownScopes.length === 0 && shownProjects.length === 0;

  const menuBlur = useMenuBlur(() => setOpen(false));
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div
      ref={ref}
      className="scope-switcher"
      {...menuBlur}
      onKeyDown={(e) => {
        if (!open) return;
        const els = items();
        const at = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") { e.stopPropagation(); close(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); els[Math.min(els.length - 1, at + 1)]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); els[Math.max(0, at - 1)]?.focus(); }
      }}
    >
      <button type="button" className="scope-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen((o) => !o); setQuery(""); }}>
        {label} ▾
      </button>
      {open && (
        <div className="scope-menu">
          {searchable && <SearchInput value={query} onChange={setQuery} label="Search scopes and projects" onKeyDown={(e) => { if (e.key === "Enter") menuSearchKeys(e); }} />}
          <div role="menu" aria-label="Portfolio scope">
          {showAll && (
            <button type="button" role="menuitemradio" aria-checked={selection.kind === "all"} className="scope-item" autoFocus={!searchable} onClick={() => pick({ kind: "all" })}>
              <span>All projects</span><span className="scope-meta">{selection.kind === "all" ? "✓ " : ""}{projects.length} {projects.length === 1 ? "project" : "projects"}</span>
            </button>
          )}
          {(shownScopes.length > 0 || scopes.length === 0) && <p className="scope-head">Saved scopes</p>}
          {scopes.length === 0 && <p className="scope-empty">{error ?? "None yet"}</p>}
          {shownScopes.map((s) => (
            <div key={s.id} className="scope-row">
              <button type="button" role="menuitemradio" aria-checked={selection.kind === "scope" && selection.id === s.id} className="scope-item" onClick={() => pick({ kind: "scope", id: s.id })}>
                <span>{s.name}</span><span className="scope-meta">{selection.kind === "scope" && selection.id === s.id ? "✓ " : ""}{s.projectIds.length} {s.projectIds.length === 1 ? "project" : "projects"}</span>
              </button>
              {canEdit && (
                <button type="button" role="menuitem" className="scope-edit" aria-label={`Edit scope ${s.name}`} onClick={() => { close(); setDialog({ scope: s }); }}>Edit</button>
              )}
            </div>
          ))}
          {shownProjects.length > 0 && <p className="scope-head">Projects</p>}
          {shownProjects.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={selection.kind === "project" && selection.id === p.id} className="scope-item" onClick={() => pick({ kind: "project", id: p.id })}>
              <span>{p.name}</span><span className="scope-meta">{selection.kind === "project" && selection.id === p.id ? "✓" : ""}</span>
            </button>
          ))}
          {canAdmin && (
            <button type="button" role="menuitem" className="scope-item scope-new" onClick={() => { close(); setProjectDialog(true); }}>+ New project</button>
          )}
          {canEdit && (
            <button type="button" role="menuitem" className="scope-item scope-new-scope" onClick={() => { close(); setDialog({ scope: null }); }}>+ New scope</button>
          )}
          </div>
          {nothing && <NoResults query={query} />}
        </div>
      )}
      {projectDialog && <ProjectDialog onClose={() => setProjectDialog(false)} onCreated={() => { setProjectDialog(false); router.refresh(); }} />}
      {dialog && (
        <ScopeDialog
          scope={dialog.scope}
          onClose={() => setDialog(null)}
          onDone={(saved) => {
            setDialog(null);
            if (saved) select({ kind: "scope", id: saved.id });
            else if (dialog.scope && selection.kind === "scope" && selection.id === dialog.scope.id) select({ kind: "all" });
          }}
        />
      )}
    </div>
  );
}
