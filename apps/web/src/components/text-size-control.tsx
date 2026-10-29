"use client";

import { useState } from "react";
import { stepTextSize, clampTextSize, TEXT_SIZES } from "@/lib/user-prefs";
import { useUserPrefs } from "./user-prefs";

/**
 * Smaller / larger text in the top bar. The whole workspace is scaled (the design is in pixels), the choice is saved in the
 * person's own profile and applied by the server on the next visit, so there is no jump when the page opens.
 */
export function TextSizeControl({ initial }: { initial?: number }) {
  const prefs = useUserPrefs();
  const [size, setSize] = useState(clampTextSize(initial));
  const change = (direction: -1 | 1) => {
    const next = stepTextSize(size, direction);
    if (next === size) return;
    setSize(next);
    const shell = document.querySelector<HTMLElement>(".shell");
    if (shell) { shell.style.zoom = String(next / 100); shell.style.setProperty("--text-zoom", String(next / 100)); }
    prefs?.saveTextSize(next);
  };
  return (
    <div className="text-size" role="group" aria-label="Text size">
      <button type="button" className="help-btn text-size-btn" onClick={() => change(-1)} disabled={size === TEXT_SIZES[0]} aria-label="Smaller text" title={`Smaller text (now ${size}%)`}>A−</button>
      <button type="button" className="help-btn text-size-btn text-size-up" onClick={() => change(1)} disabled={size === TEXT_SIZES[TEXT_SIZES.length - 1]} aria-label="Larger text" title={`Larger text (now ${size}%)`}>A+</button>
    </div>
  );
}
