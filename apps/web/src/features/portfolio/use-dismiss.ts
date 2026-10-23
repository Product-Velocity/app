"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes an open menu or panel when the person clicks or taps anywhere outside it, or presses Escape while the focus is
 * somewhere else (focus leaving is not enough: clicking blank page does not move the focus). Escape with the focus inside the
 * menu stays with the menu's own handler, which also returns the focus to its button.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const latest = useRef(close);
  useEffect(() => { latest.current = close; });
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) latest.current();
    };
    const key = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key === "Escape" && el && !el.contains(document.activeElement)) latest.current();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [ref, open]);
}
