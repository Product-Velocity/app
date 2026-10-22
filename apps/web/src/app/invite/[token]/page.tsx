import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/session";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/roles";
import { AcceptForm, InviteSignIn } from "./form";
import { getInvitePreview } from "./preview";

export const metadata = { title: "Join a workspace · Product Velocity", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const path = `/invite/${token}`;
  const supabase = await createClient();
  const preview = await getInvitePreview(supabase, token);
  const { data } = await supabase.auth.getUser();

  if (!preview) {
    return (
      <Shell title="This invitation is not valid">
        <p className="muted">
          The link may have expired, been used already, or been revoked. Ask the person who invited
          you to create a new link.
        </p>
        <Link href={data.user ? "/home" : "/sign-in"}>{data.user ? "Go to your workspace" : "Go to sign in"}</Link>
      </Shell>
    );
  }

  const role = `${ROLE_LABEL[preview.role]}${preview.isApprover ? " and Approver" : ""}`;
  const summary = (
    <p>
      You have been invited to join <strong>{preview.tenantName}</strong> as <strong>{role}</strong>{" "}
      <span className="muted">({ROLE_HELP[preview.role].toLowerCase()})</span>.
    </p>
  );

  if (!data.user) {
    return (
      <Shell title={`Join ${preview.tenantName}`}>
        {summary}
        <InviteSignIn token={token} email={preview.email} />
      </Shell>
    );
  }

  const { user } = await requireUser(path); // also sends people with 2FA to the code step first
  if (user.email?.toLowerCase() !== preview.email) {
    return (
      <Shell title={`Join ${preview.tenantName}`}>
        {summary}
        <p role="alert" className="error">
          You are signed in as <strong>{user.email}</strong>, but this invitation is for{" "}
          <strong>{preview.email}</strong>.
        </p>
        <form action="/auth/sign-out" method="post">
          <input type="hidden" name="next" value={path} />
          <button className="btn btn-primary" type="submit">
            Sign out and continue as {preview.email}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title={`Join ${preview.tenantName}`}>
      {summary}
      <p className="muted">
        You are signed in as <strong>{user.email}</strong>.
      </p>
      <AcceptForm token={token} workspace={preview.tenantName} />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
