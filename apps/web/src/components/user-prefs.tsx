"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { saveLastLocation, savePanelWidth } from "@/app/(workspace)/prefs-actions";
import { stripAccountPath } from "@/lib/account-path";
import { sanitizeLocation } from "@/lib/user-prefs";

type Prefs = { panelWidth: number; savePanelWidth: (width: number) => void };
const PrefsContext = createContext<Prefs | null>(null);

/** Null outside the workspace (the test page, for one): callers then use the default width and save nothing. */
export const useUserPrefs = () => useContext(PrefsContext);

export function UserPrefsProvider({ panelWidth, children }: { panelWidth: number; children: ReactNode }) {
  return <PrefsContext.Provider value={{ panelWidth, savePanelWidth: (w) => { void savePanelWidth(w).catch(() => undefined); } }}>{children}</PrefsContext.Provider>;
}

/**
 * Remembers the screen and the saved view the person is on, a moment after they settle on it, so the next sign-in lands there.
 * `initial` is what is already stored: nothing is written until the person goes somewhere else.
 */
export function LastLocationTracker({ initial }: { initial: string | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const saved = useRef<string | null>(initial);
  const search = params.toString();
  useEffect(() => {
    // the view is changed with history.replaceState, which Next.js reports through useSearchParams; reading the address is the safest source
    const here = sanitizeLocation(`${stripAccountPath(window.location.pathname)}${window.location.search}`);
    if (!here || here === saved.current) return;
    const t = setTimeout(() => { saved.current = here; void saveLastLocation(here).catch(() => { saved.current = null; }); }, 1500);
    return () => clearTimeout(t);
  }, [pathname, search]);
  return null;
}
