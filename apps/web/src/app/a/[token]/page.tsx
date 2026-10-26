import { CONSENT_LINES, METHODS } from "@/lib/alignment";
import { resolveLink, sameBrowser } from "@/lib/alignment-link";
import { LinkButton } from "./join-form";

export const metadata = { title: "Your vote · Product Velocity", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** The page behind a participant's personal link: no account, no sign-in. */
export default async function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);

  if (link.kind === "unknown") {
    return (
      <Shell title="This link is not valid">
        <p className="muted">The link may be mistyped, or the invitation was withdrawn. Ask the person who invited you to send it again.</p>
      </Shell>
    );
  }
  if (link.kind === "replaced") {
    return (
      <Shell title="A newer link was sent to you">
        <p>Use the most recent email you received for this session. If you cannot find it, we can send a new link to the address you were invited on.</p>
        <LinkButton token={token} action="new" label="Email me a new link" />
      </Shell>
    );
  }

  const { participant: p, session: s } = link;
  if (s.status === "draft") return <Shell title={s.name}><p>This session has not opened yet. Try again when you get the invitation.</p></Shell>;
  if (s.status !== "open") {
    return (
      <Shell title={s.name}>
        <p>This session is closed. Thank you for taking part.</p>
        {s.show_results && <p className="muted">The anonymous results will be shared here when they are ready.</p>}
      </Shell>
    );
  }

  const mine = await sameBrowser(p);
  if (p.browser_hash && !mine) {
    return (
      <Shell title="This link was opened in another browser">
        <p>For your privacy a personal link works in the browser where it was first opened. To continue here, we can send you a new link; it replaces the old one.</p>
        <LinkButton token={token} action="new" label="Email me a new link" />
      </Shell>
    );
  }

  if (!mine) {
    const method = METHODS.find((m) => m.value === s.method)!;
    return (
      <Shell title={s.name}>
        <p><strong>{method.label}.</strong> {method.help}</p>
        <div className="notice">
          <p><strong>Before you start</strong></p>
          <ul>
            {CONSENT_LINES.map((l) => <li key={l}>{l}</li>)}
            <li>Your personal data is kept for {s.retention_months} months after the session closes.</li>
          </ul>
        </div>
        <p className="muted">By continuing you agree to this. To have your data removed, ask the person who invited you.</p>
        <LinkButton token={token} action="join" label="I agree, continue" refresh />
      </Shell>
    );
  }

  return (
    <Shell title={s.name}>
      <p>You have joined. Voting opens here in the next update.</p>
    </Shell>
  );
}
