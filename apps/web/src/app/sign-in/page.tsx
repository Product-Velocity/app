import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { signInWithProvider } from "./actions";
import { PasswordForm } from "./sign-in-form";

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

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Sign in to Product Velocity</h1>
        {params.error && ERRORS[params.error] && (
          <p role="alert" className="error">
            {ERRORS[params.error]}
          </p>
        )}
        <div className="stack">
          {(["google", "github"] as const).map((provider) => (
            <form key={provider} action={signInWithProvider}>
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="next" value={next} />
              <button className="btn btn-wide" type="submit">
                Continue with {provider === "google" ? "Google" : "GitHub"}
              </button>
            </form>
          ))}
        </div>
        <div className="divider" role="separator">
          <span>or use email</span>
        </div>
        <PasswordForm next={next} mode={params.mode === "sign-up" ? "sign-up" : "sign-in"} />
      </div>
    </main>
  );
}
