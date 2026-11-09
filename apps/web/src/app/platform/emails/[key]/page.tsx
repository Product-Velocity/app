import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { EMAIL_TEMPLATES, previewTemplate } from "@/lib/email/registry/registry";
import { MACRO_CATALOG } from "@/lib/email/registry/macros";

export const metadata = { title: "Email template · Platform · Product Velocity" };

/**
 * Preview of one template with sample data (issue #370 phase 3), at desktop and phone width, as HTML and as plain text. It never sends.
 * The HTML sits in a sandboxed frame without scripts. Width and view come from the address, so the page needs no client code.
 */
export default async function PlatformEmailPreviewPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ view?: string; w?: string }> }) {
  const { key: raw } = await params;
  const { view, w } = await searchParams;
  const key = decodeURIComponent(raw);
  const t = EMAIL_TEMPLATES.find((x) => x.key === key);
  await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  if (!t) notFound();
  const r = previewTemplate(t);
  const text = view === "text";
  const phone = w === "phone";
  const href = (v: string, width: string) => `/platform/emails/${encodeURIComponent(t.key)}?view=${v}&w=${width}`;
  return (
    <div className="page-wide">
      <p><Link href="/platform/emails">&larr; All emails</Link></p>
      <h1>{t.name}</h1>
      <dl className="meta-list">
        <dt>Key</dt><dd><code>{t.key}</code></dd>
        <dt>Trigger</dt><dd>{t.trigger}</dd>
        <dt>Recipient</dt><dd>{t.recipient}</dd>
        <dt>Sent by</dt><dd>{t.path}</dd>
        <dt>Confirm first</dt><dd>{t.confirmFirst ? "Yes: a person confirms the preview" : "No"}</dd>
        <dt>Limits</dt><dd>{t.limits}</dd>
        <dt>Macros</dt><dd>{t.macros.map((m) => <code key={m} title={MACRO_CATALOG[m].label}>{`{{${m}}}`} </code>)}</dd>
        <dt>Subject</dt><dd data-testid="preview-subject">{r.subject}</dd>
      </dl>
      <p className="muted" role="note">This is a preview with sample data. Nothing is sent.</p>
      <nav aria-label="Preview options" className="tabs">
        <Link className="tab" aria-current={!text && !phone ? "page" : undefined} href={href("html", "desktop")}>HTML, desktop</Link>
        <Link className="tab" aria-current={!text && phone ? "page" : undefined} href={href("html", "phone")}>HTML, phone</Link>
        <Link className="tab" aria-current={text ? "page" : undefined} href={href("text", "desktop")}>Plain text</Link>
      </nav>
      {text ? (
        <pre data-testid="preview-text" style={{ whiteSpace: "pre-wrap", border: "1px solid #d1d5db", padding: 16, maxWidth: 640 }}>{r.text}</pre>
      ) : (
        <iframe
          title={`Preview of ${t.name}`}
          data-testid="preview-frame"
          sandbox=""
          srcDoc={r.html}
          style={{ width: phone ? 375 : 640, maxWidth: "100%", height: 720, border: "1px solid #d1d5db", background: "#f3f4f6" }}
        />
      )}
    </div>
  );
}
