import { resolveLink } from "@/lib/alignment-link";
import { LinkButton } from "../join-form";

export const metadata = { title: "Stop reminders · Product Velocity", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** Reminders can be stopped from the email. The button is on this page (not the link itself) so a mail scanner opening the link changes nothing. */
export default async function StopRemindersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);
  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <h1>Stop reminders</h1>
        {link.kind === "unknown" ? (
          <p className="muted">This link is not valid. Ask the person who invited you.</p>
        ) : (
          <>
            <p>You will not get more reminders for this session. You can still vote with your personal link until the session closes.</p>
            <LinkButton token={token} action="stop" label="Stop reminders" />
          </>
        )}
      </div>
    </main>
  );
}
