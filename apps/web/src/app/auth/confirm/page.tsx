import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { parseCallbackParams } from "@/lib/auth/callback-params";
import { inviteTokenFromNext } from "@/lib/invite-accept";
import { ConfirmForm } from "./confirm-form";

export const metadata = { title: "Continue · Product Velocity", robots: { index: false } };

/**
 * Landing page for emailed links (issue #689). Opening it uses nothing up: mail scanners that open links never press the
 * button. The one-time token is verified when the person presses Continue (POST /auth/callback).
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") params.set(k, v);
  const parsed = parseCallbackParams(params);
  if (parsed.kind !== "otp") redirect("/sign-in?error=callback");

  const invite = inviteTokenFromNext(parsed.next) !== null;
  const recovery = parsed.type === "recovery";
  const title = invite ? "Confirm your email and join" : recovery ? "Continue to reset your password" : "Continue to sign in";
  const text = invite
    ? "Press Continue to confirm your email address. You then join the workspace and see a one-minute welcome."
    : recovery
      ? "Press Continue, then choose a new password."
      : "Press Continue to finish signing in.";
  return (
    <AuthShell>
      <div>
        <h1>{title}</h1>
        <p className="sub">{text}</p>
      </div>
      <ConfirmForm tokenHash={parsed.tokenHash} type={parsed.type} next={parsed.next} />
      <p className="hint">This link works once. You are the only person who needs to press the button.</p>
    </AuthShell>
  );
}
