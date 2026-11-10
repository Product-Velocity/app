"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMenuBlur } from "./use-menu-blur";
import { useDismiss } from "./use-dismiss";

/** A small down (open: up) arrow after a button's text: the sign that the button expands a panel under it. */
export function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg className="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={open ? "M2 6.5 5 3.5 8 6.5" : "M2 3.5 5 6.5 8 3.5"} />
    </svg>
  );
}

/**
 * A toolbar button that expands a panel under it, with a small pointer to the button. Escape closes it and returns to the button; clicking
 * outside or leaving it closes it too. `wide` panels (filters, columns) span the bar they sit in instead of hanging under the button.
 */
export function Popover({ label, active = false, align = "left", wide = false, icon, children }: { label: ReactNode; active?: boolean; align?: "left" | "right"; wide?: boolean; /** Top-bar icon button: the label is an icon, `name` is its accessible name and tooltip, and there is no chevron. */ icon?: { name: string }; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  const menuBlur = useMenuBlur(close);
  useDismiss(ref, open, close);
  // where the pointer goes: under the middle of the button, measured from the left edge of the panel
  useLayoutEffect(() => {
    if (!open) return;
    const button = ref.current?.querySelector("button");
    const panel = ref.current?.querySelector<HTMLElement>(".popover-panel");
    if (!button || !panel) return;
    const b = button.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    setCaret(Math.max(12, Math.min(p.width - 24, b.left + b.width / 2 - p.left - 6)));
  }, [open]);
  const cls = ["popover-panel", wide ? "popover-wide" : "", align === "right" ? "popover-right" : ""].filter(Boolean).join(" ");
  return (
    <span
      ref={ref}
      className={wide ? "popover-anchor popover-anchor-bar" : "popover-anchor"}
      {...menuBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); ref.current?.querySelector<HTMLElement>("button")?.focus(); }
      }}
    >
      <button type="button" className={icon ? (open ? "bar-icon-btn bar-icon-btn-on" : "bar-icon-btn") : active || open ? "tool-btn tool-btn-on" : "tool-btn"} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} {...(icon ? { "aria-label": icon.name, title: icon.name } : {})}>
        {label}{icon ? null : <Chevron open={open} />}
      </button>
      {open && (
        <div id={id} className={cls}>
          <span className="popover-caret" aria-hidden="true" style={caret === null ? { visibility: "hidden" } : { left: caret }} />
          {children(close)}
        </div>
      )}
    </span>
  );
}
