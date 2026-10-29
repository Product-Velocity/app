"use client";

import { useEffect, useRef, type FocusEvent } from "react";

/**
 * Props for the wrapper of a menu that closes when the focus leaves it.
 * Safari does not focus a button when you click it, so pressing a menu item looks like "focus left the menu" and the menu
 * would close before the click lands. While a pointer is pressed inside the wrapper, a blur is not a reason to close.
 */
export function useMenuBlur(close: () => void) {
  const pressing = useRef(false);
  useEffect(() => {
    const up = () => { pressing.current = false; };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => { window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
  }, []);
  return {
    onPointerDownCapture: () => { pressing.current = true; },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (pressing.current) return;
      const wrapper = e.currentTarget;
      const to = e.relatedTarget as Node | null;
      if (to && wrapper.contains(to)) return;
      if (to) { close(); return; } // the focus went to something else on the page
      // The focus went nowhere: a control inside was moved or removed (a list reordering itself drops the focus for a moment), or the
      // window lost the focus. Decide once the page has settled: a control that takes the focus back keeps the menu open.
      setTimeout(() => { if (!wrapper.contains(document.activeElement)) close(); }, 0);
    },
  };
}
