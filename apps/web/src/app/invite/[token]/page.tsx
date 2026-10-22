import { requireUser } from "@/lib/session";
import { AcceptForm } from "./form";

export const metadata = { title: "Join a workspace · Product Velocity", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { user } = await requireUser(`/invite/${token}`);
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Join a workspace</h1>
        <p className="muted">
          You are signed in as <strong>{user.email}</strong>. The invitation only works for the
          email address it was sent to.
        </p>
        <AcceptForm token={token} />
      </div>
    </main>
  );
}
