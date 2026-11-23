"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { MAX_FOLLOWED, toggleFollowed } from "@/lib/user-prefs";

type Follow = { followed: ReadonlySet<string>; isFollowing: (id: string) => boolean; toggle: (id: string) => Promise<{ ok: true; following: boolean } | { ok: false; error: string }> };
const FollowContext = createContext<Follow | null>(null);

/** Null outside the workspace: callers then show nothing to follow. */
export const useFollow = () => useContext(FollowContext);

/**
 * The initiatives this person follows in this account. The list is kept in their own profile (so it follows them to every device); a tap changes it at once and is
 * saved in the background, and put back with a message if saving fails. Following changes only what is shown first; nobody is told, and nothing in the workspace changes.
 */
export function FollowProvider({ initial, save, children }: { initial: string[]; save: (ids: string[]) => Promise<void>; children: ReactNode }) {
  const [list, setList] = useState<string[]>(initial);
  const latest = useRef(list);
  const followed = useMemo(() => new Set(list), [list]);
  const toggle = useCallback<Follow["toggle"]>(async (id) => {
    const t = toggleFollowed(latest.current, id);
    if (t.full) return { ok: false, error: `You can follow up to ${MAX_FOLLOWED} initiatives. Stop following one first.` };
    const before = latest.current;
    latest.current = t.list; setList(t.list);
    try { await save(t.list); return { ok: true, following: t.following }; }
    catch { latest.current = before; setList(before); return { ok: false, error: "Could not save that. Try again." }; }
  }, [save]);
  const value = useMemo<Follow>(() => ({ followed, isFollowing: (id) => followed.has(id), toggle }), [followed, toggle]);
  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}
