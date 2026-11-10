import Link from "next/link";
import type { EmailTemplate } from "@/lib/email/registry/registry";

export type EmailStat = { template_key: string; sends: number | string; failures: number | string; delivered: number | string; bounced: number | string; last_sent: string | null };

/** Which trigger sends which template (issue #370, phase 3). Read-only: the mapping is code and is never editable. Counts are the last 30 days. */
export function EmailsTable({ templates, stats }: { templates: readonly EmailTemplate[]; stats: EmailStat[] }) {
  const by = new Map(stats.map((s) => [s.template_key, s]));
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid="emails-table">
        <caption className="visually-hidden">Product emails: triggers and templates</caption>
        <thead>
          <tr>
            <th scope="col">Event (trigger)</th>
            <th scope="col">Template</th>
            <th scope="col">Recipient</th>
            <th scope="col">Sent by</th>
            <th scope="col">Confirm first</th>
            <th scope="col">Limits</th>
            <th scope="col">Sent, 30 days</th>
            <th scope="col">Failed, 30 days</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => {
            const s = by.get(t.key);
            return (
              <tr key={t.key}>
                <td>{t.trigger}</td>
                <td><Link href={`/platform/emails/${encodeURIComponent(t.key)}`}>{t.name}</Link><br /><code className="muted">{t.key}</code></td>
                <td>{t.recipient}</td>
                <td>{t.path}</td>
                <td>{t.confirmFirst ? "Yes: a person confirms the preview" : "No"}</td>
                <td>{t.limits}</td>
                <td>{Number(s?.sends ?? 0)}</td>
                <td>{Number(s?.failures ?? 0)}</td>
              </tr>
            );
          })}
          <tr>
            <td>A decision gate is requested, decided or moved</td>
            <td>No email</td>
            <td>The approvers and the item owner, in the app</td>
            <td>In-app notifications only (docs/28-DECISION-GATES.md)</td>
            <td>Not applicable</td>
            <td>Not applicable</td>
            <td>0</td>
            <td>0</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
