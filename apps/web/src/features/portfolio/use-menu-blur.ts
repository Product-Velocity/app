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
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
    },
  };
}
