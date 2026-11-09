import { requirePlatformAdmin } from "@/lib/session";
import { EMAIL_TEMPLATES } from "@/lib/email/registry/registry";
import { EmailsTable, type EmailStat } from "./emails-table";

export const metadata = { title: "Emails · Platform · Product Velocity" };

/** Platform Emails area, read-only (issue #370 phase 3): which trigger sends which template, with sends and failures of the last 30 days. */
export default async function PlatformEmailsPage() {
  const { supabase } = await requirePlatformAdmin("/platform/emails");
  const { data } = await supabase.rpc("platform_email_stats", { p_days: 30 });
  return (
    <div className="page-wide">
      <h1>Emails</h1>
      <p className="muted">
        Every product email is rendered by the app from one template registry, in one branded layout. The mapping from trigger to template, the links,
        the recipients and the layout are code and cannot be edited here. Open a template to preview it; a preview never sends anything. If the
        editable wording cannot be read, the code default is sent.
      </p>
      <EmailsTable templates={EMAIL_TEMPLATES} stats={(data ?? []) as EmailStat[]} />
    </div>
  );
}
