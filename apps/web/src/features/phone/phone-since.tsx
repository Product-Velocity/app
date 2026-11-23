"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeTypeLabel, type ChangeRowData } from "@pv/domain";
import { ago } from "./phone-changes";
import { SHOWN_LIMIT, changesSince, readLastLook, sinceWords, writeLastLook } from "./phone-seen";

const browserStore = (): Storage | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };

/** "N changes since Friday": review them in one list, then mark them seen. The moment is kept on this device only (see phone-seen.ts). */
export function SinceLastLook({ rows, tenantId, me }: { rows: readonly ChangeRowData[]; tenantId: string; me: string | null }) {
  // mounted only after the changes have loaded in the browser, so reading the device's storage here cannot mismatch the server render
  const [since, setSince] = useState<Date>(() => readLastLook(browserStore(), tenantId, new Date()));
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState(true);
  const fresh = useMemo(() => changesSince(rows, since, me), [rows, since, me]);
  if (fresh.length === 0) return !kept ? <p className="muted" role="status">This browser cannot remember what you have seen, so the last 3 days are shown.</p> : null;
  const now = new Date();
  const markSeen = () => { setKept(writeLastLook(browserStore(), tenantId, now)); setSince(now); setOpen(false); };
  return (
    <section className="phone-since" aria-label="Since you last looked">
      <p className="phone-since-head"><strong>{fresh.length} {fresh.length === 1 ? "change" : "changes"}</strong> {sinceWords(since, now)}</p>
      <div className="phone-since-actions">
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Review"}</button>
        <button type="button" className="btn" onClick={markSeen}>Mark all seen</button>
      </div>
      {open && (
        <ul className="phone-cards" aria-label="Changes since you last looked">
          {fresh.slice(0, SHOWN_LIMIT).map((c) => (
            <li key={c.id}>
              <Link className="phone-card" href={`/w/${tenantId}/portfolio/${encodeURIComponent(c.code)}`}>
                <span className="phone-card-top"><span className="mono">{c.code}</span><span className="muted">{c.source} · {ago(c.at, now)}</span></span>
                <span className="phone-card-name">{c.name}</span>
                <span className={`phone-change phone-change-${c.tone}`}>{changeTypeLabel(c.type)}: {c.from ? `${c.from} → ${c.to ?? "empty"}` : c.to}</span>
              </Link>
            </li>
          ))}
          {fresh.length > SHOWN_LIMIT && <li className="muted">and {fresh.length - SHOWN_LIMIT} more, older ones. Mark all seen to clear them.</li>}
        </ul>
      )}
    </section>
  );
}
