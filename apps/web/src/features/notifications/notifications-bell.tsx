"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { changeBadge, changeBreakdownText, changeLogHref, notificationTarget, notificationText, sortNotifications, totalChanges, unreadCount, watchedProjects, type AppNotification, type WatchedProject } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { Popover } from "../portfolio/popover";
import { SupabaseChangeWatchSource, SupabaseNotificationSource, type ChangeWatchSource, type NotificationSource } from "./notification-source";

const POLL_MS = 60_000;

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * The bell icon in the top bar, next to Help and the account menu. Two parts in one panel:
 * - Changes: every project of every account the person can open, with the changes since they last cleared it (Phase, Status, Health, Build status, linked issue), the total on the bell as a number,
 *   a count per type under each project, a "Clear counts" button, and a click on a project that opens its change log (the Changes report) and clears that project.
 * - Decisions (issue #341): the people who can decide a gate see requests here, and a requester sees the decision.
 * Polls every minute and when the tab comes back. Text only; the count on the bell has words in its name, not just a dot.
 */
export function NotificationsBell({ tenantId, source: given, changeSource: givenChanges, onOpen, onOpenChanges }: { tenantId?: string; source?: NotificationSource; /** The change counters; left out on a test page that gives only `source`. */ changeSource?: ChangeWatchSource; /** Test pages: what a click does instead of navigating. */ onOpen?: (target: ReturnType<typeof notificationTarget>) => void; /** Test pages: where a click on a project would lead. */ onOpenChanges?: (href: string) => void }) {
  const router = useRouter();
  // no connection configured (a test page without Supabase): no bell, instead of a crash
  const source = useMemo(() => {
    if (given) return given;
    try { return new SupabaseNotificationSource(createClient(), tenantId ?? ""); } catch { return null; }
  }, [given, tenantId]);
  const changeSource = useMemo(() => {
    if (givenChanges) return givenChanges;
    if (given) return null;
    try { return new SupabaseChangeWatchSource(createClient()); } catch { return null; }
  }, [givenChanges, given]);
  const [list, setList] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<WatchedProject[]>([]);
  const [changeError, setChangeError] = useState<string | null>(null);

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
  useEffect(() => {
    if (!changeSource) return;
    let off = false;
    (async () => {
      try { const rows = await changeSource.load(); if (!off) { setProjects(watchedProjects(rows)); setChangeError(null); } } catch (e) { if (!off) setChangeError((e as Error).message); }
    })();
    return () => { off = true; };
  }, [changeSource, tick]);
  // poll while the tab is visible and when it comes back
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const v = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [load]);

  if (!source) return null;
  const unread = unreadCount(list);
  const changes = totalChanges(projects);
  const badge = changes + unread;
  const clearAll = async () => { setProjects([]); try { await changeSource!.clear(); } catch (e) { setChangeError((e as Error).message); } load(); };
  const openProject = async (p: WatchedProject, close: () => void) => {
    close();
    setProjects((cur) => cur.filter((x) => !(x.tenantId === p.tenantId && x.projectId === p.projectId)));
    try { await changeSource!.clear(p.tenantId, p.projectId); } catch { /* the log still opens; the count comes back on the next read */ }
    const href = changeLogHref(p.tenantId, p.projectId);
    if (onOpenChanges) { onOpenChanges(href); return; }
    // another account is a full page load (the layout and workspace data belong to the account); the same account is a client navigation
    if (p.tenantId !== tenantId) window.location.assign(href); else router.push(href);
  };
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
    <Popover align="right" icon={{ name: changes > 0 ? `Notifications, ${changeBadge(badge)} new: ${changes} ${changes === 1 ? "change" : "changes"}, ${unread === 0 ? "none unread" : `${unread} unread`}` : `Notifications, ${unread === 0 ? "none unread" : `${unread} unread`}` }} label={<span className="bar-icon-btn-inner"><BellIcon />{badge > 0 && <span className="icon-badge" aria-hidden="true">{changeBadge(badge)}</span>}</span>}>
      {(close) => (
        <div className="notif-panel" role="region" aria-label="Notifications">
          {error && <p role="alert" className="error">Could not read notifications ({error}).</p>}
          {changeError && <p role="alert" className="error">Could not read changes ({changeError}).</p>}
          {projects.length > 0 && (
            <section aria-label="Changes">
              <div className="notif-head">
                <strong>{changes === 1 ? "1 change" : `${changes} changes`} since you last cleared</strong>
                <button type="button" className="bulk-link" onClick={() => void clearAll()}>Clear counts</button>
              </div>
              <ul className="notif-list">
                {projects.map((p) => (
                  <li key={`${p.tenantId}:${p.projectId}`}>
                    <button type="button" className="notif-item chg-watch-item" title="Open its change log" onClick={() => void openProject(p, close)}>
                      <span className="chg-watch-row"><strong className="chg-watch-name">{p.projectName}</strong><span className="pill chg-watch-count">{p.total}<span className="sr-only"> {p.total === 1 ? "change" : "changes"}</span></span></span>
                      <span className="muted notif-when">{p.tenantName} · {changeBreakdownText(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {list.length === 0 ? (projects.length === 0 ? <p className="muted notif-empty" role="status">No notifications.</p> : null) : (
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
