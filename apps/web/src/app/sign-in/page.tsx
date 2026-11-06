import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { PasswordForm } from "./sign-in-form";
import { AuthShell } from "@/components/auth-shell";
import { AuthProviders } from "@/components/auth-providers";

export const metadata = { title: "Sign in · Product Velocity" };

const ERRORS: Record<string, string> = {
  callback:
    "That link could not sign you in. If you just confirmed your email, it is confirmed: sign in below. Otherwise the link may have expired, so please try again.",
  provider: "That sign-in method is not available right now. Use email, or try again later.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(next);
  const mode = params.mode === "sign-up" ? "sign-up" : "sign-in";

  return (
    <AuthShell>
      <div>
        <h1>{mode === "sign-up" ? "Create your account" : "Sign in"}</h1>
        <p className="sub">{mode === "sign-up" ? "Start with one roadmap." : "Welcome back."}</p>
      </div>
      {params.error && ERRORS[params.error] && (
        <p role="alert" className="error">
          {ERRORS[params.error]}
        </p>
      )}
      <AuthProviders next={next} />
      <PasswordForm next={next} mode={mode} />
    </AuthShell>
  );
}
