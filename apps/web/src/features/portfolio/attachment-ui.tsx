"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The parts every entry on the Spec tab shares (issue #325): a small icon or thumbnail, the "shared with GitHub/Jira" chip, and one "⋯" menu.
 * Documents, files and links use the same row, so they look and behave the same.
 */

export type MenuItem = { label: string; onSelect?: () => void; href?: string; download?: boolean; danger?: boolean; hidden?: boolean };

/** A "⋯" menu: opens with Enter or a click, arrows move, Esc closes (and does not close the panel behind it). */
export function RowMenu({ label, items, triggerText }: { label: string; items: MenuItem[]; /** Visible text for the button (the Add menu); the default is "⋯". */ triggerText?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const shown = items.filter((i) => !i.hidden);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  if (shown.length === 0) return null;
  const move = (e: React.KeyboardEvent, d: number) => {
    const els = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    els[(at + d + els.length) % els.length]?.focus();
    e.preventDefault();
  };
  return (
    <span className="row-menu" ref={root}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") { e.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLElement>(".row-menu-btn")?.focus(); }
        else if (e.key === "ArrowDown") move(e, 1);
        else if (e.key === "ArrowUp") move(e, -1);
        else if (e.key === "Tab") setOpen(false);
      }}>
      <button type="button" className={triggerText ? "row-menu-btn row-menu-text" : "row-menu-btn"} aria-haspopup="menu" aria-expanded={open} {...(triggerText ? {} : { "aria-label": label })} onClick={() => setOpen((o) => !o)}>{triggerText ?? "⋯"}</button>
      {open && (
        <ul className="row-menu-list" role="menu" aria-label={label}>
          {shown.map((i) => (
            <li key={i.label} role="none">
              {i.href
                ? <a role="menuitem" tabIndex={-1} href={i.href} {...(i.download ? {} : { target: "_blank", rel: "noreferrer" })} onClick={() => setOpen(false)}>{i.label}</a>
                : <button type="button" role="menuitem" tabIndex={-1} className={i.danger ? "row-menu-danger" : undefined} onClick={() => { setOpen(false); i.onSelect?.(); }}>{i.label}</button>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * Whether an entry goes into the GitHub issue / Jira description. Always says it in words (never colour alone). `locked` shows the state without a switch.
 */
export function ShareChip({ shared, tracker, name, disabled, busy, onToggle }: { shared: boolean; tracker: string; name: string; disabled?: boolean; busy?: boolean; onToggle: (next: boolean) => void }) {
  const text = shared ? `Shared with ${tracker}` : "Only in Product Velocity";
  if (disabled) return <span className={shared ? "share-chip share-chip-on" : "share-chip"}>{text}</span>;
  return (
    <button type="button" className={shared ? "share-chip share-chip-on" : "share-chip"} aria-pressed={shared} disabled={busy}
      aria-label={`${text}. ${shared ? "Do not share" : "Share"} ${name}`} title={shared ? "Click to keep it only in Product Velocity" : `Click to share it with ${tracker}`}
      onClick={() => onToggle(!shared)}>
      {text}
    </button>
  );
}

/** The small square at the start of a row: a thumbnail for an image, otherwise a short label for the kind. */
export function RowIcon({ kind, src, onClick, label }: { kind: "doc" | "pdf" | "image" | "link"; src?: string; onClick?: () => void; label?: string }) {
  const body: ReactNode = kind === "image" && src
    // eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated route, not optimisable
    ? <img src={src} alt="" loading="lazy" />
    : <span aria-hidden="true">{kind === "doc" ? "DOC" : kind === "pdf" ? "PDF" : kind === "image" ? "IMG" : "URL"}</span>;
  return onClick
    ? <button type="button" className="row-icon row-icon-btn" aria-label={label} onClick={onClick}>{body}</button>
    : <span className="row-icon" aria-hidden="true">{body}</span>;
}

/** Inline rename: the name as text; Enter saves, Esc cancels. */
export function NameEdit({ value, label, onSave, onCancel }: { value: string; label: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (save: boolean) => { if (done.current) return; done.current = true; if (save) onSave(v); else onCancel(); };
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} className="row-name-edit" aria-label={label} value={v} maxLength={200} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.stopPropagation(); finish(false); } }}
      onBlur={() => finish(true)} />
  );
}

export const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
