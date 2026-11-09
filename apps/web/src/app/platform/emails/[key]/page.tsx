import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { EMAIL_TEMPLATES, type TemplateText } from "@/lib/email/registry/registry";
import { FIELD_LABELS } from "@/lib/email/registry/validate";
import { TemplateEditor } from "./editor";
import { discardDraft, publishDraft, restoreVersion, saveDraft, sendTest, TEST_SENDS_PER_HOUR } from "./actions";

export const metadata = { title: "Email template · Platform · Product Velocity" };

type VersionRow = TemplateText & { version: number; status: "draft" | "published" | "superseded"; restored_from: number | null; created_by_name: string | null; created_at: string; published_by_name: string | null; published_at: string | null };

const NOTICE: Record<string, [string, boolean]> = {
  saved: ["Draft saved. It does not change what is sent until you publish it.", false],
  published: ["Published. This wording is sent from now on. The change is in the platform audit log.", false],
  restored: ["Restored as a new published version. The change is in the platform audit log.", false],
  discarded: ["Draft discarded.", false],
  "test-sent": ["Test sent to your own address.", false],
  "test-failed": ["The test could not be sent. Check the email settings.", true],
  invalid: ["That wording is not allowed (HTML, links or unknown macros). Nothing was saved.", true],
  failed: ["That did not work. Please try again.", true],
  "no-draft": ["There is no draft to publish.", true],
  "no-email": ["Email is not set up on this deployment, so a test cannot be sent.", true],
  limit: [`You can send ${TEST_SENDS_PER_HOUR} tests an hour. Try again later.`, true],
  "in-account": ["Leave the customer account you entered before sending a test (platform admins cannot send while inside an account).", true],
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * One email in the platform Emails area (issue #370 phase 4): edit the wording with a live preview, save a draft, publish, restore an older
 * version, compare versions, and send a test to yourself. Only the words can change; the frame, links, tokens and recipients cannot.
 */
export default async function PlatformEmailPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ notice?: string; compare?: string }> }) {
  const { key: raw } = await params;
  const { notice, compare } = await searchParams;
  const key = decodeURIComponent(raw);
  const { supabase } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  const t = EMAIL_TEMPLATES.find((x) => x.key === key);
  if (!t) notFound();
  const { data } = await supabase.rpc("platform_email_versions", { p_key: key });
  const versions = ((data ?? []) as VersionRow[]);
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const published = versions.find((v) => v.status === "published") ?? null;
  const base = draft ?? published;
  const defaults: TemplateText = { subject: t.subject, preheader: t.preheader, heading: t.heading, body: t.body, button: t.button, note: t.note };
  const initial: TemplateText = base ? { subject: base.subject, preheader: base.preheader, heading: base.heading, body: base.body, button: base.button, note: base.note } : defaults;
  const site = await siteUrl();
  const [a, b] = (compare ?? "").split(",").map(Number);
  const va = versions.find((v) => v.version === a), vb = versions.find((v) => v.version === b);
  const label = (v: VersionRow) => `Version ${v.version}${v.status === "published" ? " (published)" : v.status === "draft" ? " (draft)" : ""}`;
  const n = notice ? NOTICE[notice] : undefined;
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
      </dl>
      {n && <p role="status" className={n[1] ? "notice notice-error" : "notice"} data-testid="notice">{n[0]}</p>}
      <TemplateEditor
        key={`${key}-${draft?.version ?? "x"}-${published?.version ?? "x"}`}
        templateKey={t.key}
        initial={initial}
        siteUrl={site}
        isAuth={t.key.startsWith("auth.")}
        hasDraft={!!draft}
        hasPublished={!!published}
        saveAction={saveDraft.bind(null, t.key)}
        testAction={sendTest.bind(null, t.key)}
        publishAction={publishDraft.bind(null, t.key)}
        discardAction={discardDraft.bind(null, t.key)}
      />
      <h2>Versions</h2>
      {versions.length === 0 ? (
        <p className="muted">No edits yet. The code default is being sent.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="versions-table">
            <caption className="visually-hidden">Versions of this email</caption>
            <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Saved by</th><th scope="col">Published</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td>{v.version}{v.restored_from ? ` (restored from ${v.restored_from})` : ""}</td>
                  <td>{v.status === "published" ? "Published, being sent" : v.status === "draft" ? "Draft" : "Earlier version"}</td>
                  <td>{v.created_by_name ?? ""}<br /><span className="muted">{fmt(v.created_at)}</span></td>
                  <td>{v.published_at ? <>{v.published_by_name}<br /><span className="muted">{fmt(v.published_at)}</span></> : ""}</td>
                  <td>
                    {published && v.version !== published.version && <Link href={`?compare=${v.version},${published.version}`}>Compare with published</Link>}
                    {v.status === "superseded" && (
                      <form action={restoreVersion.bind(null, t.key, v.version)} className="row-form">
                        <button className="btn" type="submit">Restore</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {va && vb && (
        <section aria-label="Compare versions" data-testid="compare">
          <h3>{label(va)} compared with {label(vb)}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Field</th><th scope="col">{label(va)}</th><th scope="col">{label(vb)}</th></tr></thead>
              <tbody>
                {(Object.keys(FIELD_LABELS) as (keyof TemplateText)[]).filter((f) => (va[f] ?? "") !== (vb[f] ?? "")).map((f) => (
                  <tr key={f}><th scope="row">{FIELD_LABELS[f]}</th><td style={{ whiteSpace: "pre-wrap" }}>{va[f]}</td><td style={{ whiteSpace: "pre-wrap" }}>{vb[f]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {(Object.keys(FIELD_LABELS) as (keyof TemplateText)[]).every((f) => (va[f] ?? "") === (vb[f] ?? "")) && <p className="muted">The wording is the same.</p>}
        </section>
      )}
    </div>
  );
}
