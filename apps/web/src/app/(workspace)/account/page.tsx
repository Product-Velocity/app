import { requireWorkspace } from "@/lib/session";
import { canUnlink, LINKABLE, leaveMessage, PROVIDER_LABEL, profileFromMetadata, timeZones } from "@/lib/account";
import { EmailForm, GithubUsernameForm, LinkedEmails, PasswordForm, ProfileForm, type LinkedEmail } from "./forms";
import { leaveWorkspace, linkProvider, signOutSessions, unlinkProvider } from "./actions";
import { switchTenant } from "../actions";
import Link from "next/link";

export const metadata = { title: "Account · Product Velocity" };

const NOTICE: Record<string, string> = {
  unlinked: "Sign-in method removed.",
  "last-method": "You cannot remove your only sign-in method. Add another one first.",
  "unlink-failed": "We could not remove that sign-in method.",
  "link-failed": "We could not start linking that account. An admin may need to switch on account linking in the Supabase Auth settings.",
  "bad-provider": "That sign-in method is not available.",
  "signed-out-others": "Signed out of all your other devices.",
  left: "You left the workspace.",
  "email-removed": "Address removed.",
  "email-removed-review": "Address removed. Access that came only through it now waits for the workspace admin to review.",
  "email-failed": "We could not do that. Please try again.",
  "notify-saved": "Notification address saved.",
  "last-admin": leaveMessage("PV003"),
  "leave-failed": leaveMessage(undefined),
};
const ROLE: Record<string, string> = { admin: "Admin", creator: "Creator", commenter: "Commenter", viewer: "Viewer", leadership: "Leadership" };

/** The person's own account (docs/15 §3): profile, email, password, sign-in methods, sessions and workspaces. Two-factor stays under Security. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, user, memberships, active } = await requireWorkspace("/account");
  const { data: ids } = await supabase.auth.getUserIdentities();
  const identities = ids?.identities ?? [];
  const hasPassword = identities.some((i) => i.provider === "email");
  const profile = profileFromMetadata(user.user_metadata);
  const { data: emailRows } = await supabase.rpc("my_emails");
  const emails = (emailRows ?? []) as LinkedEmail[];
  const { data: mine } = await supabase.from("tenant_members").select("github_username").eq("tenant_id", active.tenantId).eq("user_id", user.id).maybeSingle();

  return (
    <div className="page-narrow">
      <h1>Account</h1>
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}

      <h2>Profile</h2>
      <div className="card"><ProfileForm profile={profile} zones={timeZones()} /></div>

      <h2>GitHub</h2>
      <div className="card"><GithubUsernameForm current={(mine?.github_username as string | null) ?? ""} workspace={active.tenantName} /></div>

      <h2>Email</h2>
      <div className="card"><EmailForm email={user.email ?? ""} hasPassword={hasPassword} /></div>

      <h2>Linked emails</h2>
      <div className="card"><LinkedEmails emails={emails} /></div>

      <h2>Password</h2>
      <div className="card"><PasswordForm hasPassword={hasPassword} /></div>

      <h2>Sign-in methods</h2>
      <div className="card stack">
        <ul className="plain-list">
          {identities.map((i) => (
            <li key={i.identity_id} className="row-form">
              <strong>{PROVIDER_LABEL[i.provider] ?? i.provider}</strong>
              {i.provider !== "email" && (
                <form action={unlinkProvider}>
                  <input type="hidden" name="provider" value={i.provider} />
                  <button className="btn" type="submit" disabled={!canUnlink(identities, i.provider)} title={canUnlink(identities, i.provider) ? undefined : "It is your only sign-in method"}>Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {LINKABLE.filter((p) => !identities.some((i) => i.provider === p)).map((p) => (
          <form key={p} action={linkProvider}>
            <input type="hidden" name="provider" value={p} />
            <button className="btn" type="submit">Add {PROVIDER_LABEL[p]}</button>
          </form>
        ))}
        <p className="muted">Two-factor sign-in is under <Link href="/settings/security">Security</Link>.</p>
      </div>

      <h2>Sessions</h2>
      <div className="card stack">
        <p className="muted">Signed in on this device now. The list of devices is not available from our sign-in provider, but you can end every other session, or all of them.</p>
        <div className="row-form">
          <form action={signOutSessions}><input type="hidden" name="scope" value="others" /><button className="btn" type="submit">Sign out other devices</button></form>
          <form action={signOutSessions}><input type="hidden" name="scope" value="global" /><button className="btn" type="submit">Sign out everywhere</button></form>
        </div>
      </div>

      <h2>My workspaces</h2>
      <div className="card">
        <table className="table">
          <thead><tr><th scope="col">Workspace</th><th scope="col">Your role</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.tenantId}>
                <th scope="row">{m.tenantName}{m.tenantId === active.tenantId && <span className="muted"> · current</span>}</th>
                <td>{ROLE[m.role] ?? m.role}{m.isApprover ? " · Approver" : ""}</td>
                <td className="row-form">
                  {m.tenantId !== active.tenantId && <form action={switchTenant}><input type="hidden" name="tenantId" value={m.tenantId} /><button className="btn" type="submit">Switch to it</button></form>}
                  <form action={leaveWorkspace}>
                    <input type="hidden" name="tenant_id" value={m.tenantId} />
                    <button className="btn" type="submit" aria-label={`Leave ${m.tenantName}`}>Leave</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">A workspace always keeps at least one admin, so its last admin cannot leave. Leaving does not delete the work you did there.</p>
        <p><Link className="btn" href="/onboarding?new=1">+ New account</Link> You become its first admin and can invite people from Members in the account menu.</p>
      </div>

      <h2>Notifications</h2>
      <div className="card"><p className="muted">Notification settings arrive when notifications are designed. Nothing is sent to you yet beyond sign-in and invitation emails.</p></div>

      <h2>Your data</h2>
      <div className="card"><p className="muted">Downloading your data and deleting your account arrive in the next release.</p></div>
    </div>
  );
}
