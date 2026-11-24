"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A grid fills the page below it (the rule of every grid in the app): the height is what is left of the window under the grid's top edge, minus the
 * footer line under it, and follows window resizes and changes in the content above it (filter chips wrapping, notices). `active` is false while the
 * grid is not rendered yet (loading, no rows), so the measuring starts when it appears. Never smaller than `min`.
 */
export function fillHeight(windowHeight: number, top: number, foot: number, min = 360, bottom = 36): number {
  return Math.max(min, Math.floor(windowHeight - top - foot - bottom));
}

export function useFillHeight(active: boolean, min = 360) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      setHeight(fillHeight(window.innerHeight, wrap.getBoundingClientRect().top + window.scrollY, footRef.current?.offsetHeight ?? 0, min));
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    return () => { window.removeEventListener("resize", fit); ro.disconnect(); };
  }, [active, min]);
  return { wrapRef, footRef, height };
}
