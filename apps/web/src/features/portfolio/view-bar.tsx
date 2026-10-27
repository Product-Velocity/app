"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addToBar, BAR_FULL_MESSAGE, changeSummary, computeBar, diffViews, isCustomerSafe, layoutRowsFor, moveInBar, moveToIndex, nameProblem, refKey, removeFromBar, sameRef,
  filterOptions, needsSearch, sanitizeView, visibleTabs, BUILTIN_BAR_NAMES, VIEW_NAMES, type BuiltinBarName, type MenuEntry, type ViewDef, type ViewName, type ViewRef,
} from "@pv/domain";
import { menuSearchKeys, NoResults, SearchInput } from "@/components/search-list";
import { useWorkspace } from "../workspace/provider";
import type { SavedView } from "../workspace/store";
import { baseDef, baseLabel, sameView, type BaseView } from "./grid-view";
import type { Command } from "./palette";
import { useDismiss } from "./use-dismiss";
import { useMenuBlur } from "./use-menu-blur";
import { Chevron } from "./popover";

// ------------------------------------------------------------------ helpers
export const refToBase = (r: ViewRef): BaseView => (r.kind === "saved" ? { kind: "saved", id: r.id } : r.name === "All columns" ? { kind: "all" } : { kind: "builtin", name: r.name as ViewName });
export const baseToRef = (b: BaseView): ViewRef => (b.kind === "saved" ? { kind: "saved", id: b.id } : b.kind === "all" ? { kind: "builtin", name: "All columns" } : { kind: "builtin", name: b.name });
const OPEN_VIEWS_EVENT = "pv:open-views";
const isCap = (msg: string) => /at most 25/.test(msg);

type Toast = { text: string; undo?: () => Promise<void> };
type Dialog =
  | { kind: "save" }
  | { kind: "rename"; entry: MenuEntry }
  | { kind: "delete"; entry: MenuEntry }
  | { kind: "update-all" }
  | { kind: "make-private"; entry: MenuEntry };

/** Everything the view bar, the unsaved-changes bar and the ⌘K palette do with views, in one place so the three stay the same. */
export function useViews({ base, def, bDef, dirty, openBase, discard, reset }: { base: BaseView; def: ViewDef; bDef: ViewDef; dirty: boolean; openBase: (b: BaseView) => void; /** Drops the column changes of the open view (after they were saved). */ discard: () => void; /** Drops every unsaved change (filters, grouping, sort and columns). */ reset: () => void }) {
  const openRaw = openBase;
  const { store, reload, views, defaults, layouts, userId, canAdmin } = useWorkspace();
  const [managing, setManaging] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ text: string; cap: boolean } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const barViews = useMemo(() => views.map((v) => ({ id: v.id, name: v.name, ownerId: v.ownerId, baseView: v.baseView })), [views]);
  const personal = useMemo(() => computeBar({ views: barViews, workspaceLayout: layouts.workspace, myLayout: layouts.mine, me: userId }), [barViews, layouts, userId]);
  // what an admin edits in "Manage": the workspace default, as everyone without a layout of their own sees it
  const workspaceOnly = useMemo(() => computeBar({ views: barViews.filter((v) => v.ownerId === null), workspaceLayout: layouts.workspace, myLayout: [], me: null }), [barViews, layouts.workspace]);
  const shown = managing ? workspaceOnly : personal;
  const allKnown = useMemo<ViewRef[]>(() => [...BUILTIN_BAR_NAMES.map((name) => ({ kind: "builtin", name }) as ViewRef), ...views.filter((v) => !v.baseView).map((v) => ({ kind: "saved", id: v.id }) as ViewRef)], [views]);

  const viewOf = useCallback((e: { ref: ViewRef }) => { const r = e.ref; return r.kind === "saved" ? views.find((v) => v.id === r.id) : undefined; }, [views]);
  const isWorkspaceRef = (r: ViewRef) => r.kind === "builtin" || views.find((v) => v.id === r.id)?.ownerId === null;
  const current: SavedView | undefined = base.kind === "saved" ? views.find((v) => v.id === base.id) : undefined;
  const builtinName: ViewName | null = base.kind === "builtin" ? base.name : null;
  const mayWrite = (v: SavedView) => (v.ownerId === null ? canAdmin : v.ownerId === userId);

  const say = (text: string | null) => setMessage(text ? { text, cap: isCap(text) } : null);
  const showToast = (t: Toast) => setToast(t);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(id);
  }, [toast]);
  const undoToast = async () => { const t = toast; setToast(null); if (t?.undo) await t.undo(); };
  // ⌘Z / Ctrl+Z undoes the last view change while its message is on screen (not inside a text box, which has its own undo)
  useEffect(() => {
    if (!toast?.undo) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true], .ag-root")) return;
      e.preventDefault();
      void undoToast();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  // ---- the bar
  const writeBar = async (bar: ViewRef[], hidden: ViewRef[] = workspaceOnly.hidden.map((e) => e.ref)): Promise<boolean> => {
    const rows = layoutRowsFor(bar, allKnown.filter((r) => (managing ? isWorkspaceRef(r) : !hidden.some((h) => sameRef(h, r)))), managing ? hidden : []);
    const r = await store.replaceLayout(managing, rows);
    if (!r.ok) { say(r.error); return false; }
    await reload();
    say(null);
    return true;
  };
  const toggleInBar = async (ref: ViewRef) => {
    const on = shown.bar.some((b) => sameRef(b, ref));
    if (on) return writeBar(removeFromBar(shown.bar, ref));
    const r = addToBar(shown.bar, ref);
    if (!r.ok) { say(r.error); return false; }
    return writeBar(r.bar);
  };
  const move = (ref: ViewRef, by: -1 | 1) => writeBar(moveInBar(shown.bar, ref, by));
  const moveTo = (ref: ViewRef, to: number) => writeBar(moveToIndex(shown.bar, ref, to));
  const resetLayout = async () => {
    const r = await store.replaceLayout(false, []);
    if (!r.ok) { say(r.error); return; }
    await reload(); say(null);
  };

  // ---- views: open, rename, duplicate, delete, scope, hide
  const entryDef = (ref: ViewRef): ViewDef | null => baseDef(refToBase(ref), views.filter((v) => !v.baseView), defaults);
  const ownNames = (workspace: boolean) => [
    ...views.filter((v) => !v.baseView && (workspace ? v.ownerId === null : v.ownerId === userId)).map((v) => v.name),
    ...(workspace ? [...BUILTIN_BAR_NAMES] : []),
  ];

  const create = async (name: string, workspace: boolean, d: ViewDef): Promise<string | null> => {
    const r = await store.createView(name, d, { workspace });
    if (!r.ok) { say(r.error); return r.error; }
    await reload();
    say(null);
    discard(); // the changes now live in the new view
    openRaw({ kind: "saved", id: r.value.id });
    return null;
  };
  const duplicate = async (entry: MenuEntry) => {
    const d = entryDef(entry.ref);
    if (!d) return;
    const taken = ownNames(false);
    let name = `${entry.name} copy`;
    for (let i = 2; taken.some((t) => t.toLowerCase() === name.toLowerCase()); i++) name = `${entry.name} copy ${i}`;
    await create(name, false, d);
  };
  const rename = async (entry: MenuEntry, name: string): Promise<string | null> => {
    const v = viewOf(entry); if (!v) return "That view no longer exists.";
    const before = v.name;
    const r = await store.updateView(v.id, { name });
    if (!r.ok) return r.error;
    await reload();
    showToast({ text: `Renamed “${before}” to “${r.value.name}”.`, undo: async () => { await store.updateView(v.id, { name: before }); await reload(); } });
    return null;
  };
  const remove = async (entry: MenuEntry) => {
    const v = viewOf(entry); if (!v) return;
    const wasOpen = base.kind === "saved" && base.id === v.id;
    const first = personal.bar.find((r) => !sameRef(r, entry.ref));
    const r = await store.deleteView(v.id);
    if (!r.ok) { say(r.error); return; }
    await reload();
    if (wasOpen) openRaw(first ? refToBase(first) : { kind: "builtin", name: "Prioritisation" });
    const snapshot: ViewDef = sanitizeView(v);
    const workspace = v.ownerId === null;
    showToast({
      text: `Deleted “${v.name}”.`,
      undo: async () => { const c = await store.createView(v.name, snapshot, { workspace }); if (!c.ok) say(c.error); await reload(); },
    });
  };
  const setScope = async (entry: MenuEntry, workspace: boolean) => {
    const v = viewOf(entry); if (!v) return;
    const r = await store.setViewScope(v.id, workspace);
    if (!r.ok) { say(r.error); return; }
    await reload(); say(null);
  };
  const hide = async (entry: MenuEntry) => {
    if (entry.ref.kind !== "builtin") return;
    const hidden = [...workspaceOnly.hidden.map((e) => e.ref), entry.ref];
    const prevBar = workspaceOnly.bar, prevHidden = workspaceOnly.hidden.map((e) => e.ref);
    const rows = layoutRowsFor(removeFromBar(workspaceOnly.bar, entry.ref), allKnown.filter(isWorkspaceRef), hidden);
    const r = await store.replaceLayout(true, rows);
    if (!r.ok) { say(r.error); return; }
    await reload();
    if (base.kind !== "saved" && sameRef(baseToRef(base), entry.ref)) openRaw({ kind: "builtin", name: "Prioritisation" });
    showToast({
      text: `Hid “${entry.name}” for everyone.`,
      undo: async () => { await store.replaceLayout(true, layoutRowsFor(prevBar, allKnown.filter(isWorkspaceRef), prevHidden)); await reload(); },
    });
  };
  const restore = async (entry: MenuEntry) => {
    const hidden = workspaceOnly.hidden.map((e) => e.ref).filter((r) => !sameRef(r, entry.ref));
    const rows = layoutRowsFor(workspaceOnly.bar, allKnown.filter(isWorkspaceRef), hidden);
    const r = await store.replaceLayout(true, rows);
    if (!r.ok) { say(r.error); return; }
    await reload(); say(null);
  };
  const restoreOriginal = async (name: ViewName) => {
    const r = await store.restoreDefaultView(name);
    if (!r.ok) { say(r.error); return; }
    await reload(); say(null);
  };

  // ---- saving from the unsaved-changes bar: update the open view, or save as a new one
  const updateKind: "private" | "workspace" | "none" = current ? (current.ownerId === null ? "workspace" : "private") : builtinName ? "workspace" : "none";
  const updateAllowed = updateKind === "private" ? current?.ownerId === userId : updateKind === "workspace" ? canAdmin : false;
  const updateLabel = updateKind === "workspace" ? "Update for everyone" : current ? `Update “${current.name}”` : "Update";
  const updateBlocked = updateKind === "workspace" && !canAdmin ? "Workspace views can only be changed by an admin. Save as your own view instead." : null;
  const doUpdate = async () => {
    const r = current ? await store.updateView(current.id, def) : builtinName ? await store.saveDefaultView(builtinName, def) : null;
    if (!r) return;
    if (!r.ok) { say(r.error); return; }
    await reload(); say(null);
    discard(); // the saved view now is what is on screen
  };
  const requestUpdate = () => { if (!updateAllowed) return; if (updateKind === "workspace") setDialog({ kind: "update-all" }); else void doUpdate(); };
  const requestSave = () => { say(null); setDialog({ kind: "save" }); };

  // ---- palette
  const commands = ((): Command[] => {
    const out: Command[] = [];
    for (const n of VIEW_NAMES) out.push({ id: `view:${n}`, label: `Go to view: ${n}`, group: "Views", keywords: "columns", run: () => openBase({ kind: "builtin", name: n }) });
    out.push({ id: "view:all", label: "Go to view: All columns", group: "Views", keywords: "every field", run: () => openBase({ kind: "all" }) });
    for (const v of views) if (!v.baseView) out.push({ id: `view:${v.id}`, label: `Go to view: ${v.name}`, group: v.ownerId === null ? "Workspace views" : "My views", run: () => openBase({ kind: "saved", id: v.id }) });
    if (dirty) {
      out.push({ id: "view:reset", label: "Reset view changes", group: "Views", keywords: "discard", run: reset });
      out.push({ id: "view:save-new", label: "Save as new view…", group: "Views", keywords: "save view", run: requestSave });
      if (updateAllowed) out.push({ id: "view:update", label: updateKind === "workspace" ? "Update the open view for everyone" : `Update view “${current?.name}”`, group: "Views", keywords: "save view", run: requestUpdate });
    }
    const open = current ? ({ ref: { kind: "saved", id: current.id }, name: current.name, scope: current.ownerId === null ? "workspace" : "private", inBar: false, isNew: false, builtin: false } as MenuEntry) : null;
    if (open) {
      out.push({ id: "view:duplicate", label: "Duplicate view", group: "Views", keywords: current?.name, run: () => void duplicate(open) });
      if (mayWrite(current!)) {
        out.push({ id: "view:rename", label: "Rename view", group: "Views", keywords: current?.name, run: () => setDialog({ kind: "rename", entry: open }) });
        out.push({ id: "view:delete", label: "Delete view", group: "Views", keywords: current?.name, run: () => setDialog({ kind: "delete", entry: open }) });
      }
    } else {
      const ref = baseToRef(base);
      out.push({ id: "view:duplicate", label: "Duplicate view", group: "Views", keywords: baseLabel(base, views), run: () => void duplicate({ ref, name: baseLabel(base, views), scope: "workspace", inBar: false, isNew: false, builtin: true }) });
    }
    return out;
  })();

  return {
    base, current, builtinName, dirty, def, bDef, managing, setManaging, state: shown, personal, workspaceOnly, canAdmin, userId, views, defaults,
    message, say, toast, undoToast, setToast, dialog, setDialog,
    reset, toggleInBar, move, moveTo, resetLayout, duplicate, rename, remove, setScope, hide, restore, restoreOriginal, create, ownNames, viewOf, mayWrite,
    update: { kind: updateKind, allowed: updateAllowed, label: updateLabel, blocked: updateBlocked, request: requestUpdate, run: doUpdate },
    requestSave, commands, openBase: openRaw, discard, bar: shown.bar, saveDialogProps: { ownNames },
  };
}
export type ViewsApi = ReturnType<typeof useViews>;

// ----------------------------------------------------------------- dialogs
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Asks for a name (1 to 80 characters, free for this owner); the message under the box appears as you type. */
function NameField({ value, onChange, taken, onEnter, label = "Name" }: { value: string; onChange: (v: string) => void; taken: string[]; onEnter: () => void; label?: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const problem = nameProblem(value, taken);
  return (
    <>
      <label htmlFor={id} className="dialog-label">{label}</label>
      <input id={id} ref={ref} value={value} maxLength={80} aria-invalid={touched && !!problem} aria-describedby={`${id}-e`}
        onChange={(e) => { onChange(e.target.value); setTouched(true); }} onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }} />
      <p id={`${id}-e`} className="quick-add-error" role={touched && problem ? "alert" : undefined}>{touched && problem ? problem : ""}</p>
    </>
  );
}

function SaveDialog({ api }: { api: ViewsApi }) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(false);
  const [safe, setSafe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = api.ownNames(workspace);
  const notSafe = api.def.columns.filter((c) => !isCustomerSafe(c));
  const close = () => api.setDialog(null);
  const submit = async () => {
    if (busy || nameProblem(name, taken)) return;
    setBusy(true);
    const err = await api.create(name, workspace, workspace && safe ? { ...api.def, customerSafe: true } : { ...api.def, customerSafe: false });
    setBusy(false);
    if (err) setError(err); else close();
  };
  return (
    <Modal title="Save as new view" onClose={close}>
      <NameField value={name} onChange={setName} taken={taken} onEnter={() => void submit()} />
      {api.canAdmin && (
        <fieldset className="dialog-fieldset">
          <legend className="dialog-label">Who sees it</legend>
          <label className="columns-item"><input type="radio" name="vis" checked={!workspace} onChange={() => setWorkspace(false)} /> Only me <span className="muted">(a private view in My views)</span></label>
          <label className="columns-item"><input type="radio" name="vis" checked={workspace} onChange={() => setWorkspace(true)} /> Workspace <span className="muted">(everyone sees it; only admins change it)</span></label>
        </fieldset>
      )}
      {api.canAdmin && workspace && (
        <>
          <label className="columns-item dialog-check">
            <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
            Customer-safe view
            <span className="muted"> — only fields allowed in customer reports (never value, confidence, customers, decisions, key results, outcomes or markets).</span>
          </label>
          {safe && notSafe.length > 0 && (
            <p className="panel-note" role="status">These columns are not customer-safe and will be left out: {notSafe.slice(0, 6).join(", ")}{notSafe.length > 6 ? ` and ${notSafe.length - 6} more` : ""}. Filters, grouping and sort on other fields are left out too.</p>
          )}
        </>
      )}
      {error && <p role="alert" className="quick-add-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !!nameProblem(name, taken)} onClick={() => void submit()}>Save view</button>
      </div>
    </Modal>
  );
}

function RenameDialog({ api, entry }: { api: ViewsApi; entry: MenuEntry }) {
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const taken = api.ownNames(entry.scope === "workspace").filter((n) => n.toLowerCase() !== entry.name.toLowerCase());
  const close = () => api.setDialog(null);
  const submit = async () => {
    if (nameProblem(name, taken)) return;
    const err = await api.rename(entry, name);
    if (err) setError(err); else close();
  };
  return (
    <Modal title="Rename view" onClose={close}>
      <NameField value={name} onChange={setName} taken={taken} onEnter={() => void submit()} />
      {error && <p role="alert" className="quick-add-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!!nameProblem(name, taken)} onClick={() => void submit()}>Rename</button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ title, body, action, danger = false, onClose, onConfirm }: { title: string; body: ReactNode; action: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{body}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" autoFocus onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? "btn btn-danger" : "btn btn-primary"} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>{action}</button>
      </div>
    </Modal>
  );
}

export function ViewDialogs({ api }: { api: ViewsApi }) {
  const d = api.dialog;
  const close = () => api.setDialog(null);
  if (!d) return null;
  if (d.kind === "save") return <SaveDialog api={api} />;
  if (d.kind === "rename") return <RenameDialog api={api} entry={d.entry} />;
  if (d.kind === "delete") {
    const ws = d.entry.scope === "workspace";
    return <ConfirmDialog title={`Delete “${d.entry.name}”?`} danger action="Yes, delete view" onClose={close} onConfirm={() => api.remove(d.entry)}
      body={ws ? "The view is removed for everyone in the workspace. Items are not affected." : "The view is removed for you. Items are not affected."} />;
  }
  if (d.kind === "update-all") {
    return <ConfirmDialog title="Update for everyone?" action="Update for everyone" onClose={close} onConfirm={api.update.run}
      body={api.current ? `This changes “${api.current.name}” for the whole workspace.` : `This changes the default “${api.builtinName}” view for the whole workspace.`} />;
  }
  return <ConfirmDialog title={`Make “${d.entry.name}” private?`} action="Make private" onClose={close} onConfirm={() => api.setScope(d.entry, false)}
    body="It disappears for everyone else in the workspace, and only you will see it." />;
}

// -------------------------------------------------------------- the view bar
const TAB_WIDTH = 112;

function ActionsMenu({ api, entry, onDone }: { api: ViewsApi; entry: MenuEntry; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  const blur = useMenuBlur(close);
  useDismiss(ref, open, close);
  const v = entry.ref.kind === "saved" ? api.viewOf(entry) : undefined;
  const writable = v ? api.mayWrite(v) : false;
  const items: { label: string; run: () => void | Promise<void> }[] = [];
  if (v && writable) items.push({ label: "Rename…", run: () => api.setDialog({ kind: "rename", entry }) });
  items.push({ label: "Duplicate", run: () => api.duplicate(entry) });
  if (v && writable) items.push({ label: "Delete…", run: () => api.setDialog({ kind: "delete", entry }) });
  if (v && api.canAdmin && v.ownerId === api.userId) items.push({ label: "Make workspace view", run: () => api.setScope(entry, true) });
  if (v && api.canAdmin && v.ownerId === null) items.push({ label: "Make private…", run: () => api.setDialog({ kind: "make-private", entry }) });
  if (entry.builtin && api.canAdmin && entry.ref.kind === "builtin") {
    items.push({ label: "Hide for everyone", run: () => api.hide(entry) });
    const name = entry.ref.name;
    if (name !== "All columns" && api.defaults[name as ViewName]) items.push({ label: "Restore the original", run: () => api.restoreOriginal(name as ViewName) });
  }
  return (
    <span ref={ref} className="vm-actions" {...blur}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); ref.current?.querySelector("button")?.focus(); } }}>
      <button type="button" className="vm-more" aria-label={`Actions for ${entry.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div id={id} role="menu" aria-label={`Actions for ${entry.name}`} className="popover-panel vm-actions-panel">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="scope-item" onClick={async () => { close(); onDone?.(); await it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}

function MenuRow({ api, entry, index, onOpen }: { api: ViewsApi; entry: MenuEntry; index: number; onOpen: (r: ViewRef) => void }) {
  const active = refKey(baseToRef(api.base)) === refKey(entry.ref);
  return (
    <div className="vm-row" role="group" aria-label={entry.name}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && entry.inBar) { e.preventDefault(); void api.move(entry.ref, e.key === "ArrowUp" ? -1 : 1); }
      }}>
      <button type="button" className="vm-open" aria-current={active ? "true" : undefined} onClick={() => onOpen(entry.ref)}>
        <span className="vm-name">{entry.name}</span>
        <span className="vm-tag">{entry.scope === "workspace" ? "workspace" : "private"}</span>
        {entry.isNew && <span className="vm-new">New</span>}
      </button>
      <button type="button" className={entry.inBar ? "vm-toggle vm-toggle-on" : "vm-toggle"} aria-pressed={entry.inBar} data-index={index}
        onClick={() => void api.toggleInBar(entry.ref)}>{entry.inBar ? "In bar" : "Show in bar"}</button>
      {entry.inBar && (
        <>
          <button type="button" className="vm-move" aria-label={`Move ${entry.name} earlier in the bar`} onClick={() => void api.move(entry.ref, -1)}>↑</button>
          <button type="button" className="vm-move" aria-label={`Move ${entry.name} later in the bar`} onClick={() => void api.move(entry.ref, 1)}>↓</button>
        </>
      )}
      <ActionsMenu api={api} entry={entry} />
    </div>
  );
}

function MoreViews({ api, count }: { api: ViewsApi; count: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => { setOpen(false); setQuery(""); };
  const blur = useMenuBlur(close);
  useDismiss(ref, open, close);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_VIEWS_EVENT, on);
    return () => window.removeEventListener(OPEN_VIEWS_EVENT, on);
  }, []);
  const st = api.state;
  const total = st.mine.length + st.workspace.length;
  const search = needsSearch(total);
  const keep = (list: MenuEntry[]) => filterOptions(list.map((e) => ({ e, label: e.name })), query).map((x) => x.e);
  const mine = keep(st.mine), workspace = keep(st.workspace), hidden = api.canAdmin ? keep(st.hidden) : [];
  const onOpen = (r: ViewRef) => { api.openBase(refToBase(r)); close(); btn.current?.focus(); };
  return (
    <span ref={ref} className="popover-anchor" {...blur}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className={open ? "tool-btn tool-btn-on" : "tool-btn"} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {count} more {count === 1 ? "view" : "views"}{api.dirty && <span className="vm-dot" title="This view has changes you have not saved" aria-label="(this view has changes)"> ●</span>}<Chevron open={open} />
      </button>
      {open && (
        <div id={id} className="popover-panel popover-right views-panel vm-panel" role="dialog" aria-label="Views">
          {api.managing && <p className="panel-note" role="status">Editing the workspace default bar. People who set their own bar keep it.</p>}
          <section aria-label="Current view" className="vm-current">
            <p className="scope-head">Current view: {baseLabel(api.base, api.views)}{api.dirty ? " (changed)" : ""}</p>
            {api.dirty && <p className="panel-note">{changeSummary(diffViews(api.bDef, api.def)) || "Changed"} since it was saved. Changes stay as you switch views until you reset or save them.</p>}
            <div className="vm-current-actions">
              {api.update.kind !== "none" && (
                <span title={api.update.blocked ?? undefined}>
                  <button type="button" className="tool-btn" disabled={!api.dirty || !api.update.allowed} onClick={() => { close(); api.update.request(); }}>{api.update.label}</button>
                </span>
              )}
              <button type="button" className="tool-btn" onClick={() => { close(); api.requestSave(); }}>Save as new view…</button>
              <button type="button" className="tool-btn" disabled={!api.dirty} onClick={() => { api.reset(); }}>Reset changes</button>
            </div>
            {api.update.blocked && api.dirty && <p className="panel-note">{api.update.blocked}</p>}
          </section>
          {search && <SearchInput value={query} onChange={setQuery} label="Search views" onKeyDown={menuSearchKeys} />}
          {mine.length > 0 && (
            <section aria-label="My views">
              <p className="scope-head">My views</p>
              {mine.map((e, i) => <MenuRow key={refKey(e.ref)} api={api} entry={e} index={i} onOpen={onOpen} />)}
            </section>
          )}
          {workspace.length > 0 && (
            <section aria-label="Workspace views">
              <p className="scope-head">Workspace views</p>
              {workspace.map((e, i) => <MenuRow key={refKey(e.ref)} api={api} entry={e} index={i} onOpen={onOpen} />)}
            </section>
          )}
          {hidden.length > 0 && (
            <section aria-label="Hidden views">
              <p className="scope-head">Hidden views (admins only)</p>
              {hidden.map((e) => (
                <div key={refKey(e.ref)} className="vm-row"><span className="vm-open"><span className="vm-name">{e.name}</span><span className="vm-tag">hidden</span></span>
                  <button type="button" className="vm-toggle" onClick={() => void api.restore(e)}>Restore</button></div>
              ))}
            </section>
          )}
          {query !== "" && mine.length + workspace.length + hidden.length === 0 && <NoResults query={query} />}
          <div className="vm-foot">
            {!api.state.followsWorkspace && !api.managing && <button type="button" className="btn btn-link" onClick={() => void api.resetLayout()}>Reset to workspace layout</button>}
            {api.canAdmin && <button type="button" className="btn btn-link" aria-pressed={api.managing} onClick={() => api.setManaging(!api.managing)}>{api.managing ? "Done managing" : "Manage workspace bar"}</button>}
          </div>
        </div>
      )}
    </span>
  );
}

/** The view row: at most six tabs, the open view as a temporary extra tab, and "N more views". */
export function ViewBar({ api }: { api: ViewsApi }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(6);
  const [dragging, setDragging] = useState<string | null>(null);
  useEffect(() => {
    // measured on the header, not on the row: the row is only as wide as its tabs. 360px is left for the title, the menu button and tools.
    const el = rowRef.current?.parentElement;
    if (!el) return;
    const measure = () => setFits(Math.max(1, Math.min(6, Math.floor((el.clientWidth - 360) / TAB_WIDTH))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const open = baseToRef(api.base);
  const { tabs, extra, overflow } = visibleTabs(api.bar, open, fits);
  const entries = useMemo(() => new Map([...api.state.mine, ...api.state.workspace, ...api.state.hidden, ...api.personal.mine, ...api.personal.workspace].map((e) => [refKey(e.ref), e])), [api.state, api.personal]);
  const entryFor = (r: ViewRef): MenuEntry => entries.get(refKey(r)) ?? { ref: r, name: r.kind === "builtin" ? r.name : "Saved view", scope: "workspace", inBar: true, isNew: false, builtin: r.kind === "builtin" };
  const tab = (r: ViewRef, temp = false) => {
    const e = entryFor(r);
    const on = sameRef(r, open);
    const k = refKey(r);
    const title = r.kind === "builtin" ? (r.name === "All columns" ? "All fields" : api.defaults[r.name as ViewName] ? "Default view, changed by your workspace" : "Default view") : e.scope === "private" ? "Private view" : "Workspace view";
    return (
      <span key={k} className={`vm-tab${on ? " vm-tab-on" : ""}${temp ? " vm-tab-temp" : ""}${dragging === k ? " vm-dragging" : ""}`}
        draggable={!temp} onDragStart={(ev) => { setDragging(k); ev.dataTransfer.setData("text/plain", k); ev.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => setDragging(null)} onDragOver={(ev) => { if (dragging && !temp) ev.preventDefault(); }}
        onDrop={(ev) => { ev.preventDefault(); const from = api.bar.find((b) => refKey(b) === dragging); setDragging(null); if (from && !temp) void api.moveTo(from, api.bar.findIndex((b) => sameRef(b, r))); }}>
        <button type="button" className={on ? "view-chip view-chip-on" : "view-chip"} aria-pressed={on} title={temp ? `${title} (not in your bar)` : title}
          onClick={() => api.openBase(refToBase(r))}
          onKeyDown={(ev) => { if (ev.altKey && !temp && (ev.key === "ArrowUp" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowRight")) { ev.preventDefault(); void api.move(r, ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 1); } }}>
          {e.name}
        </button>
        <ActionsMenu api={api} entry={e} />
      </span>
    );
  };
  return (
    <div ref={rowRef} className="view-row">
      <div className="view-chips" role="group" aria-label="View">
        {tabs.map((r) => tab(r))}
        {extra && tab(extra, true)}
      </div>
      <MoreViews api={api} count={api.state.moreCount + overflow} />
      {api.message && (
        <span role="alert" className="quick-add-error"> {api.message.text}{" "}
          {api.message.cap && <button type="button" className="btn btn-link" onClick={() => window.dispatchEvent(new Event(OPEN_VIEWS_EVENT))}>See the list of views</button>}
        </span>
      )}
      <ViewDialogs api={api} />
      {api.toast && (
        <div className="view-toast" role="status">
          {api.toast.text}
          {api.toast.undo && <button type="button" className="btn btn-link" onClick={() => void api.undoToast()}>Undo</button>}
          <button type="button" className="chip-x" aria-label="Dismiss" onClick={() => api.setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

export { sameView, BAR_FULL_MESSAGE };
export type { BuiltinBarName };
