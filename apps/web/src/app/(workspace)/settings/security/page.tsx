import { requireUser } from "@/lib/session";
import { EnrollTotp } from "./enroll";
import { removeFactor } from "./actions";

export const metadata = { title: "Security · Product Velocity" };

export default async function SecurityPage() {
  const { supabase } = await requireUser("/settings/security");
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = data?.totp ?? [];

  return (
    <div className="page-narrow">
      <h1>Security</h1>
      <h2>Two-factor sign-in</h2>
      <div className="card stack">
        {verified.length > 0 ? (
          <>
            <p role="status">
              <strong>On.</strong> You will be asked for a code from your authenticator app each
              time you sign in.
            </p>
            {verified.map((f) => (
              <form key={f.id} action={removeFactor}>
                <input type="hidden" name="factorId" value={f.id} />
                <button className="btn" type="submit">
                  Turn off ({f.friendly_name ?? "Authenticator app"})
                </button>
              </form>
            ))}
          </>
        ) : (
          <>
            <p>
              <strong>Off.</strong> Two-factor sign-in is optional. It adds a code from your phone
              to your password.
            </p>
            <EnrollTotp />
          </>
        )}
      </div>
    </div>
  );
}
