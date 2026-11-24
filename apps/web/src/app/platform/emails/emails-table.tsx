import Link from "next/link";
import { defaultEmailStatus, type EmailStatus, type EmailTemplate } from "@/lib/email/registry/registry";
import { setEmailStatus } from "./status-actions";

export type EmailStat = { template_key: string; sends: number | string; failures: number | string; delivered: number | string; bounced: number | string; last_sent: string | null };

export type StatusRow = { template_key: string; status: EmailStatus; changed_at: string; changed_by_name: string | null };

export type OpenStat = { template_key: string; tracked: number | string; opened: number | string };

/** "3 of 12 (25%)" for a template that carries the open-tracking image, "Not tracked" for the rest. Opens are a floor: some mail programs block images. */
export function openText(s: OpenStat | undefined, tracks: boolean): string {
  if (!tracks) return "Not tracked";
  const tracked = Number(s?.tracked ?? 0);
  if (tracked === 0) return "No sends yet";
  const opened = Number(s?.opened ?? 0);
  return `${opened} of ${tracked} (${Math.round((opened / tracked) * 100)}%)`;
}

/** Which trigger sends which template (issue #370, phase 3). Read-only: the mapping is code and is never editable. Counts are the last 30 days. */
export function EmailsTable({ templates, stats, opens = [], statuses = [] }: { templates: readonly EmailTemplate[]; stats: EmailStat[]; opens?: OpenStat[]; statuses?: StatusRow[] }) {
  const by = new Map(stats.map((s) => [s.template_key, s]));
  const openBy = new Map(opens.map((o) => [o.template_key, o]));
  const statusBy = new Map(statuses.map((x) => [x.template_key, x]));
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid="emails-table">
        <caption className="visually-hidden">Product emails: triggers and templates</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Event (trigger)</th>
            <th scope="col">Template</th>
            <th scope="col">Recipient</th>
            <th scope="col">Sent by</th>
            <th scope="col">Confirm first</th>
            <th scope="col">Limits</th>
            <th scope="col">Sent, 30 days</th>
            <th scope="col">Failed, 30 days</th>
            <th scope="col">Opened, 30 days</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => {
            const s = by.get(t.key);
            const status: EmailStatus = t.alwaysOn ? "active" : statusBy.get(t.key)?.status ?? defaultEmailStatus(t);
            return (
              <tr key={t.key}>
                <td><StatusCell t={t} status={status} /></td>
                <td>{t.trigger}</td>
                <td><Link href={`/platform/emails/${encodeURIComponent(t.key)}`}>{t.name}</Link><br /><code className="muted">{t.key}</code></td>
                <td>{t.recipient}</td>
                <td>{t.path}</td>
                <td>{t.confirmFirst ? "Yes: a person confirms the preview" : "No"}</td>
                <td>{t.limits}</td>
                <td>{Number(s?.sends ?? 0)}</td>
                <td>{Number(s?.failures ?? 0)}</td>
                <td>{openText(openBy.get(t.key), !!t.trackOpens)}</td>
              </tr>
            );
          })}
          <tr>
            <td>Not an email</td>
            <td>A decision gate is requested, decided or moved</td>
            <td>No email</td>
            <td>The approvers and the item owner, in the app</td>
            <td>In-app notifications only (docs/28-DECISION-GATES.md)</td>
            <td>Not applicable</td>
            <td>Not applicable</td>
            <td>0</td>
            <td>0</td>
            <td>Not tracked</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Active or Paused, always as text. A paused email is not sent; the one-click switch is missing for emails that must always go out. */
function StatusCell({ t, status }: { t: EmailTemplate; status: EmailStatus }) {
  if (t.alwaysOn) return <><strong>Active</strong><br /><span className="muted">Always on</span></>;
  const next: EmailStatus = status === "active" ? "paused" : "active";
  return (
    <form action={setEmailStatus}>
      <input type="hidden" name="key" value={t.key} />
      <input type="hidden" name="status" value={next} />
      <strong>{status === "active" ? "Active" : "Paused"}</strong>{" "}
      <button className="btn btn-sm" type="submit" aria-label={`${next === "paused" ? "Pause" : "Activate"} ${t.name}`}>{next === "paused" ? "Pause" : "Activate"}</button>
    </form>
  );
}
