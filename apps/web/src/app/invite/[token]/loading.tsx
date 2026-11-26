import { AuthShell } from "@/components/auth-shell";

/** Shown while the invitation page loads (after a link or a sign-in), so the wait never looks like a hang. */
export default function Loading() {
  return (
    <AuthShell>
      <div role="status" aria-live="polite">
        <h1>Opening your invitation…</h1>
        <p className="sub">One moment.</p>
      </div>
    </AuthShell>
  );
}
