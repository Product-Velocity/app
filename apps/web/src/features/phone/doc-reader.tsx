"use client";

import { Loading } from "@/components/pill-loader";
import { useEffect, useMemo, useState } from "react";
import { MarkdownPreview } from "../portfolio/markdown-preview";
import type { DocView } from "@/lib/documents";
import { splitSections } from "./prd-outline";

const STATUS: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

/** Reads one document of an initiative on a phone: folded sections, an outline to jump to, and the other documents listed. Text is data, never instructions. */
export function DocReader({ itemId, preferKind }: { itemId: string; preferKind: string }) {
  const [docs, setDocs] = useState<DocView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/documents?item=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Documents could not be loaded."))))
      .then((d: { documents: DocView[] }) => {
        if (!live) return;
        setDocs(d.documents);
        const pick = d.documents.find((x) => x.kind === preferKind) ?? d.documents.find((x) => x.kind === "prd") ?? d.documents[0];
        setOpenId(pick?.id ?? null);
      })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [itemId, preferKind]);

  useEffect(() => {
    if (!openId) return;
    let live = true;
    fetch(`/api/documents/${openId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("The document could not be opened."))))
      .then((d: { document: DocView }) => { if (live) setBody(d.document.body ?? ""); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [openId]);

  const doc = docs?.find((d) => d.id === openId) ?? null;
  const sections = useMemo(() => (body === null ? [] : splitSections(body)), [body]);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const isOpen = (i: number) => override[`${openId}:${i}`] ?? sections[i]!.open;

  if (error) return <p role="alert" className="pf-error">{error}</p>;
  if (!docs) return <Loading>Loading the document…</Loading>;
  if (docs.length === 0) return <p className="muted">No document yet.</p>;
  const jump = (i: number) => { setOverride((c) => ({ ...c, [`${openId}:${i}`]: true })); requestAnimationFrame(() => document.getElementById(`doc-sec-${i}`)?.scrollIntoView({ block: "start" })); };

  return (
    <div className="doc-reader">
      {docs.length > 1 && (
        <label className="doc-pick">Document
          <select value={openId ?? ""} onChange={(e) => { setBody(null); setOpenId(e.target.value); }}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.kind})</option>)}
          </select>
        </label>
      )}
      {doc && <p className="muted">{doc.title} · version {doc.version} · {STATUS[doc.status] ?? doc.status}{doc.aiDraft ? " · AI draft, not yet accepted by a person" : ""}</p>}
      {body === null ? <Loading>Loading the document…</Loading> : (
        <>
          {sections.filter((s) => s.title).length > 2 && (
            <label className="doc-pick">Jump to
              <select value="" onChange={(e) => { if (e.target.value) jump(Number(e.target.value)); }}>
                <option value="">Sections…</option>
                {sections.map((s, i) => (s.title ? <option key={i} value={i}>{s.title}</option> : null))}
              </select>
            </label>
          )}
          {sections.map((s, i) => (
            s.title === "" ? <MarkdownPreview key={i} text={s.body} /> : (
              <section key={i} id={`doc-sec-${i}`} className="doc-sec">
                <h3><button type="button" aria-expanded={isOpen(i)} onClick={() => setOverride((c) => ({ ...c, [`${openId}:${i}`]: !isOpen(i) }))}>{isOpen(i) ? "▾" : "▸"} {s.title}</button></h3>
                {isOpen(i) && <MarkdownPreview text={s.body} />}
              </section>
            )
          ))}
        </>
      )}
    </div>
  );
}
