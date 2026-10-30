import Link from "next/link";
import { docTypeLabel, documentLink, submissionAction, submittedBy, writtenWith, type DocSubmission } from "@/lib/document-submissions";

/** The document-submission log: who saved which document of which initiative, when, and with which AI tool and model. Titles only; the text is opened in the initiative. */
export function DocumentSubmissionsView({ rows, basePath, showAccount, more, timeZone, account }: { rows: DocSubmission[]; basePath: string; showAccount: boolean; more: boolean; timeZone: string; account?: string }) {
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  const last = rows.at(-1);
  const next = last ? `${basePath}?${new URLSearchParams({ ...(account ? { account } : {}), before: last.saved_at }).toString()}` : null;
  return (
    <>
      {rows.length === 0 ? (
        <p className="muted">No documents have been saved yet.</p>
      ) : (
        <table className="table audit-table">
          <caption className="visually-hidden">Document submissions</caption>
          <thead>
            <tr>
              <th>When</th><th>Person</th>{showAccount && <th>Account</th>}<th>Project</th><th>Initiative</th><th>Document</th><th>Type</th><th>What</th><th>Written with</th><th><span className="visually-hidden">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.version_id}>
                <td>{when(s.saved_at)}</td>
                <td>{submittedBy(s)}</td>
                {showAccount && <td>{s.tenant_name}</td>}
                <td>{s.project_name ?? "—"}</td>
                <td>{s.item_code} {s.initiative_name}</td>
                <td>{s.title}</td>
                <td>{docTypeLabel(s.kind)}</td>
                <td>{submissionAction(s)}</td>
                <td>{writtenWith(s)}</td>
                <td><Link href={documentLink(s)} aria-label={`Open ${s.title} on ${s.item_code}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more && next && <p><Link className="btn" href={next}>Older submissions</Link></p>}
    </>
  );
}
