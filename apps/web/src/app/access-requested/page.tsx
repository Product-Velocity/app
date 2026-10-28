import Link from "next/link";
import { redirect } from "next/navigation";
import { loadMemberships, requireUser } from "@/lib/session";
import { myAccessStates } from "@/lib/access-requests";

export const metadata = { title: "Access requested · Product Velocity", robots: { index: false } };

/** The holding screen (FR-2.2): static text for people waiting for an admin, and a plain message for paused or revoked people. */
export default async function AccessRequestedPage() {
  const { supabase, user } = await requireUser("/access-requested");
  if ((await loadMemberships(supabase, user.id)).length > 0) redirect("/portfolio");
  const states = await myAccessStates(supabase);
  const waiting = states.filter((s) => s.status === "requested");
  const blocked = states.filter((s) => s.status !== "requested");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>{waiting.length > 0 ? "Waiting for approval" : blocked.length > 0 ? "No access right now" : "Nothing to review"}</h1>
        {waiting.length > 0 && (
          <p>
            We requested your organization admin to review your request to join{" "}
            {waiting.map((w, i) => <span key={w.tenantId}>{i > 0 ? ", " : ""}<strong>{w.tenantName}</strong></span>)}.
            You will get an email as soon as you are approved. You can close this page.
          </p>
        )}
        {blocked.map((b) => (
          <p key={b.tenantId} className="muted">
            {b.status === "paused"
              ? <>Your access to <strong>{b.tenantName}</strong> is paused. Ask a workspace admin to turn it back on.</>
              : <>Your access to <strong>{b.tenantName}</strong> was revoked. Ask a workspace admin if you think this is a mistake.</>}
          </p>
        ))}
        {states.length === 0 && <p className="muted">You have no pending request. You can create your own workspace instead.</p>}
        <p><Link href="/onboarding?new=1">Create my own workspace instead</Link></p>
        <form action="/auth/sign-out" method="post"><button className="btn" type="submit">Sign out</button></form>
      </div>
    </main>
  );
}
