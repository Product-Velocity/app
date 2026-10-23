"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useMenuBlur } from "./use-menu-blur";

/** A toolbar button that opens a small panel under it. Escape closes it and returns to the button; leaving it closes it too. */
export function Popover({ label, active = false, align = "left", children }: { label: ReactNode; active?: boolean; align?: "left" | "right"; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  const menuBlur = useMenuBlur(close);
  return (
    <span
      ref={ref}
      className="popover-anchor"
      {...menuBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); ref.current?.querySelector<HTMLElement>("button")?.focus(); }
      }}
    >
      <button type="button" className={active ? "tool-btn tool-btn-on" : "tool-btn"} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div id={id} className={align === "right" ? "popover-panel popover-right" : "popover-panel"}>{children(close)}</div>}
    </span>
  );
}
