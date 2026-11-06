import { signInWithProvider } from "@/app/sign-in/actions";

/** Google and GitHub, shown first so people default to them. */
export function AuthProviders({ next, hint }: { next: string; hint?: string }) {
  return (
    <>
      <div className="auth-providers">
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
      {hint && <p className="hint auth-center">{hint}</p>}
      <div className="divider" role="separator">
        <span>or use email</span>
      </div>
    </>
  );
}
