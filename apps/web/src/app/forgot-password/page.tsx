import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "./form";

export const metadata = { title: "Forgot password · Product Velocity", robots: { index: false } };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const { email, error } = await searchParams;
  return (
    <AuthShell>
      {error === "expired" && (
        <p role="alert" className="error">
          That reset link has expired or was already used. Request a new one below.
        </p>
      )}
      <ForgotForm initialEmail={typeof email === "string" && email.length <= 254 ? email : ""} />
    </AuthShell>
  );
}
