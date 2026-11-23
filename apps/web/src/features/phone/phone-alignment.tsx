"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { orderSessions, summarizeSession, type SessionDb } from "./alignment-summary";

export type AlignmentLoader = () => Promise<SessionDb[]>;
const SESSION_LIMIT = 20;

/** Reads what the database lets this person read: members get closed sessions that allow results, admins get every session (RLS decides, not this screen). */
export const supabaseAlignmentLoader = (tenantId: string): AlignmentLoader => async () => {
  const { data, error } = await createClient().from("alignment_sessions")
    .select("id, name, method, status, closed_at, closes_at, results_snapshot")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(SESSION_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as SessionDb[];
};

const dateWords = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Alignment results on the Decide tab: each session with how many voted and the top initiatives; the full results are one tap away (docs/29-MOBILE.md section 10). */
export function PhoneAlignment({ tenantId, load }: { tenantId: string; load?: AlignmentLoader }) {
  const loader = useMemo(() => load ?? supabaseAlignmentLoader(tenantId), [load, tenantId]);
  const [rows, setRows] = useState<SessionDb[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    loader().then((r) => { if (!off) setRows(r); }, (e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [loader]);
  const sessions = useMemo(() => orderSessions(rows ?? []).map((s) => summarizeSession(s)), [rows]);

  if (error) return <p role="alert" className="pf-error">Could not load alignment sessions: {error}</p>;
  if (!rows) return <p role="status" className="muted">Loading…</p>;
  if (sessions.length === 0) return <p className="notice-box">No alignment results yet. Results appear here once a session has closed.</p>;
  return (
    <ul className="phone-cards" aria-label="Alignment sessions">
      {sessions.map((s) => (
        <li key={s.id}>
          <article className="phone-card phone-align">
            <span className="phone-card-top"><span className="phone-health">{s.final ? "Closed" : "Open"}</span><span className="muted">{dateWords(s.when)}</span></span>
            <h2 className="phone-card-name">{s.name}</h2>
            <span className="muted phone-card-meta">{s.method}{s.voters !== null ? ` · ${s.voters} ${s.voters === 1 ? "person" : "people"} voted` : ""}{s.contested ? ` · ${s.contested} contested` : ""}</span>
            {s.top.length > 0 ? (
              <ol className="phone-align-top" aria-label={`Top initiatives of ${s.name}`}>
                {s.top.map((t, i) => <li key={`${t.name}-${i}`}><span className="phone-align-place">{t.place}{t.tied ? "=" : ""}</span> {t.name}</li>)}
              </ol>
            ) : <p className="muted">{s.final ? "No results were stored for this session." : "Results appear when the session closes."}</p>}
            {s.more > 0 && <span className="muted phone-card-meta">and {s.more} more</span>}
            <Link href={`/w/${tenantId}/alignment/${s.id}/results`}>{s.final ? "Full results" : "Provisional results"}</Link>
          </article>
        </li>
      ))}
    </ul>
  );
}
