import { requirePlatformAdmin } from "@/lib/session";
import { EMAIL_TEMPLATES } from "@/lib/email/registry/registry";
import { EmailsTable, type EmailStat, type OpenStat, type StatusRow } from "./emails-table";

export const metadata = { title: "Emails · Platform · Product Velocity" };

/** Platform Emails area, read-only (issue #370 phase 3): which trigger sends which template, with sends and failures of the last 30 days. */
export default async function PlatformEmailsPage() {
  const { supabase } = await requirePlatformAdmin("/platform/emails");
  const { data } = await supabase.rpc("platform_email_stats", { p_days: 30 });
  const { data: statuses } = await supabase.rpc("platform_email_statuses");
  const { data: opens } = await supabase.rpc("platform_email_open_stats", { p_days: 30 });
  return (
    <div className="page-wide">
      <h1>Emails</h1>
      <p className="muted">
        Every product email is rendered by the app from one template registry, in one branded layout. The mapping from trigger to template, the links,
        the recipients and the layout are code and cannot be edited here. Open a template to preview it; a preview never sends anything. If the
        editable wording cannot be read, the code default is sent.
      </p>
      <p className="muted">
        <strong>Status.</strong> A paused email is not sent. The personal notes from Ashu start Paused; switch them to Active when their wording is confirmed. Sign-in, confirmation, reset and code emails, and the alignment mailings, are always on:
        pausing them would lock people out or break a mailing a workspace admin confirmed. Every switch is written to the platform audit log.
      </p>
      <p className="muted">
        Opens are counted only for a few of our own emails (the invitation and the two personal notes from Ashu) by a one-pixel image that holds a random id and
        nothing else. No address, name or place is stored, so an open can never be tied to a person. Treat the numbers as a floor: some mail programs block images.
      </p>
      <EmailsTable templates={EMAIL_TEMPLATES} stats={(data ?? []) as EmailStat[]} opens={(opens ?? []) as OpenStat[]} statuses={(statuses ?? []) as StatusRow[]} />
    </div>
  );
}
