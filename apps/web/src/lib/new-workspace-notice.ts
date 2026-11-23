import "server-only";
import { emailConfigured } from "@/lib/email/resend";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { buildNewWorkspaceEmail } from "@/lib/email/access";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { siteUrl } from "@/lib/site-url";

/**
 * Tells the product owner that someone finished onboarding and created a workspace. Best effort: it never throws and never blocks the
 * person. The address and workspace name go only to the contact address; the send log keeps the outcome, never the text.
 */
export async function notifyNewWorkspace(input: { tenantId: string; workspace: string; email: string | null | undefined }): Promise<void> {
  try {
    if (!emailConfigured()) return;
    const site = await siteUrl();
    const mail = buildNewWorkspaceEmail({ workspace: input.workspace, requester: input.email ?? "an unknown address", link: `${site}/platform`, siteUrl: site, override: await loadEmailOverride("app.new-workspace") });
    await sendLogged("app.new-workspace", { to: SUPPORT_CONTACT.email, ...mail }, { tenantId: input.tenantId });
  } catch {
    console.error(JSON.stringify({ newWorkspaceNotice: "failed" }));
  }
}
