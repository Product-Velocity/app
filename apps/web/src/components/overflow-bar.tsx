"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "@/features/portfolio/popover";
import { fitItems } from "@/lib/overflow-fit";

/** What an item that does not fit becomes inside the "More" menu. */
export type OverflowEntry = {
  label: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** A toggle that is on (Include completed): shown as checked and marked with a dot on the More button. */
  active?: boolean;
  disabled?: boolean;
  title?: string;
  current?: boolean;
};

export type OverflowItem = {
  id: string;
  /** The item as it looks in the bar. */
  node: ReactNode;
  /** The item inside the menu. */
  entry: OverflowEntry;
  /** Items with the higher rank move into the menu first. */
  rank: number;
  /** Never moves into the menu (the open tab). */
  pinned?: boolean;
};

const GAP = 8;
const MORE_FALLBACK = 40;

/**
 * A row of items that moves what does not fit into a "More" menu (issue #403). The row takes the space left by its neighbours
 * (`flex: 1 1 0`), measures each item once and keeps the widths, so an item that sits in the menu is not measured again.
 * Pinned items and items you can only reach by a menu entry stay reachable by keyboard at every width.
 */
export function OverflowBar({ items, label, moreLabel = "More", className = "" }: { items: OverflowItem[]; label: string; moreLabel?: string; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenKey = hidden.join("|");
  const itemsKey = items.map((i) => `${i.id}:${i.rank}:${i.pinned ? 1 : 0}`).join("|");

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    for (const el of Array.from(row.querySelectorAll<HTMLElement>("[data-ov-id]"))) {
      const w = el.getBoundingClientRect().width;
      if (w > 0) widths.current.set(el.dataset.ovId!, Math.ceil(w));
    }
    const moreW = moreRef.current ? Math.ceil(moreRef.current.getBoundingClientRect().width) : MORE_FALLBACK;
    // while the More button is shown the row is narrower by the button and a gap
    row.style.flex = ""; // read the room with the greedy rule of the stylesheet, not last time's size
    const full = row.clientWidth + (moreRef.current ? moreW + GAP : 0);
    // then the row asks for what all its items need and no more, so a neighbour that can give way (search, the "Last: ..." text) does
    const all = items.map((i) => widths.current.get(i.id));
    if (all.every((w) => w !== undefined)) row.style.flex = `0 1 ${all.reduce<number>((a, w) => a + (w ?? 0), 0) + Math.max(0, all.length - 1) * GAP}px`;
    const next = fitItems({
      items: items.map((i) => ({ id: i.id, width: widths.current.get(i.id) ?? 0, rank: i.rank, pinned: i.pinned })),
      available: full,
      moreWidth: moreW || MORE_FALLBACK,
      gap: GAP,
    });
    setHidden((prev) => (prev.join("|") === next.join("|") ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  useLayoutEffect(() => { measure(); }); // every render: a label that grows (Export 3) changes the widths
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure, hiddenKey]);

  const out = items.filter((i) => hidden.includes(i.id));
  const dot = out.some((i) => i.entry.active);
  return (
    <>
      <div ref={rowRef} className={`ov-row ${className}`.trim()} role="group" aria-label={label}>
        {items.map((i) => (
          <span key={i.id} data-ov-id={i.id} className="ov-item" hidden={hidden.includes(i.id)}>
            {i.node}
          </span>
        ))}
      </div>
      {out.length > 0 && (
        <span ref={moreRef} className="ov-more" onKeyDown={moveFocus}>
          <Popover align="right" label={<><span aria-hidden="true">⋯</span><span className="visually-hidden">{moreLabel}</span>{dot && <span className="ov-dot" aria-hidden="true" />}</>} active={dot}>
            {(close) => (
              <div role="menu" aria-label={moreLabel}>
                {out.map((i) =>
                  i.entry.href && !i.entry.disabled ? (
                    <Link key={i.id} href={i.entry.href} role="menuitem" className="scope-item" aria-current={i.entry.current ? "page" : undefined} title={i.entry.title} onClick={close}>{i.entry.label}</Link>
                  ) : (
                    <button key={i.id} type="button" role={i.entry.active !== undefined ? "menuitemcheckbox" : "menuitem"} className="scope-item" disabled={i.entry.disabled} aria-disabled={i.entry.disabled} title={i.entry.title}
                      aria-checked={i.entry.active}
                      onClick={() => { close(); i.entry.onSelect?.(); }}>
                      {i.entry.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </Popover>
        </span>
      )}
    </>
  );
}

function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
  if (els.length === 0) return;
  e.preventDefault();
  const at = els.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" || (e.key === "ArrowUp" && at < 0) ? els.length - 1 : e.key === "ArrowDown" ? (at + 1) % els.length : (at - 1 + els.length) % els.length;
  els[next]?.focus();
}
