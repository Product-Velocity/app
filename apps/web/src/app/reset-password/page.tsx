import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/session";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password · Product Velocity", robots: { index: false } };

/** The emailed link signs the person in through /auth/callback and lands here. */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return (
      <AuthShell>
        <h1>This link has expired</h1>
        <p className="muted">Reset links work once and expire after 60 minutes. Request a new one.</p>
        <Link className="btn btn-primary" href="/forgot-password?error=expired">
          Request a new link
        </Link>
      </AuthShell>
    );
  }
  const { user } = await requireUser("/reset-password");
  return (
    <AuthShell>
      <ResetForm email={user.email ?? ""} />
    </AuthShell>
  );
}
