"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notificationTarget, notificationText, sortNotifications, unreadCount, type AppNotification } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { Popover } from "../portfolio/popover";
import { SupabaseNotificationSource, type NotificationSource } from "./notification-source";

const POLL_MS = 60_000;

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * The bell icon in the top bar, next to Help and the account menu (issue #341): the people who can decide a gate see requests here, and a requester sees the decision. Polls every minute and when
 * the tab comes back, which is enough for an inbox (a request waits for a decision for days). Text only; an unread count has words, not just a dot.
 */
export function NotificationsBell({ tenantId, source: given, onOpen }: { tenantId?: string; source?: NotificationSource; /** Test pages: what a click does instead of navigating. */ onOpen?: (target: ReturnType<typeof notificationTarget>) => void }) {
  const router = useRouter();
  // no connection configured (a test page without Supabase): no bell, instead of a crash
  const source = useMemo(() => {
    if (given) return given;
    try { return new SupabaseNotificationSource(createClient(), tenantId ?? ""); } catch { return null; }
  }, [given, tenantId]);
  const [list, setList] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!source) return;
    let off = false;
    (async () => {
      try { const rows = await source.load(); if (!off) { setList(sortNotifications(rows)); setError(null); } } catch (e) { if (!off) setError((e as Error).message); }
    })();
    return () => { off = true; };
  }, [source, tick]);
  // poll while the tab is visible and when it comes back
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const v = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [load]);

  if (!source) return null;
  const unread = unreadCount(list);
  const markAll = async () => { await source!.markRead(); load(); };
  const open = async (n: AppNotification, close: () => void) => {
    close();
    if (!n.read_at) { await source!.markRead([n.id]); load(); }
    const t = notificationTarget(n);
    if (onOpen) { onOpen(t); return; }
    if (t?.kind === "decisions") router.push("/decisions");
    else if (t?.kind === "item") router.push(`/portfolio/${encodeURIComponent(t.code)}`);
  };

  return (
    <Popover align="right" icon={{ name: `Notifications, ${unread === 0 ? "none unread" : `${unread} unread`}` }} label={<span className="bar-icon-btn-inner"><BellIcon />{unread > 0 && <span className="icon-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}</span>}>
      {(close) => (
        <div className="notif-panel" role="region" aria-label="Notifications">
          {error && <p role="alert" className="error">Could not read notifications ({error}).</p>}
          {list.length === 0 ? <p className="muted notif-empty" role="status">No notifications.</p> : (
            <>
              <div className="notif-head">
                <strong>{unread === 0 ? "All read" : `${unread} unread`}</strong>
                {unread > 0 && <button type="button" className="bulk-link" onClick={() => void markAll()}>Mark all as read</button>}
              </div>
              <ul className="notif-list">
                {list.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`notif-item${n.read_at ? "" : " is-unread"}`} onClick={() => void open(n, close)}>
                      <span className="notif-text">{!n.read_at && <span className="notif-new">New. </span>}{notificationText(n)}</span>
                      <span className="muted notif-when">{when(n.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
