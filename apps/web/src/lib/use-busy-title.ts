"use client";
import { useEffect } from "react";

/** The browser tab title says "Syncing…" while `active` (brand guide, Loading and sync). The favicon stays still. Restores the title afterwards. */
export function useBusyTitle(active: boolean, label = "Syncing…") {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const before = document.title;
    document.title = `${label} ${before}`;
    return () => { document.title = before; };
  }, [active, label]);
}
