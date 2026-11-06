"use client";

import { useEffect, useState } from "react";

const COOLDOWN_SECONDS = 60;

/**
 * "Check your email" view after asking for a one-time sign-in or reset link.
 * The same words are shown whether or not the address has an account.
 * Mount it with a new `key` per send so the 60-second resend timer restarts.
 */
export function LinkSent({
  title = "Check your email",
  email,
  lifetime,
  resendAction,
  resendFields,
  pending,
  onBack,
  backLabel,
}: {
  title?: string;
  email: string;
  lifetime: string;
  resendAction: (form: FormData) => void;
  resendFields: React.ReactNode;
  pending: boolean;
  onBack?: () => void;
  backLabel: string;
}) {
  const [left, setLeft] = useState(COOLDOWN_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="stack" role="status">
      <div>
        <h1>{title}</h1>
        <p className="sub">
          If <strong>{email}</strong> has an account, we sent a link. It works once and expires in {lifetime}.
        </p>
      </div>
      <p className="notice">
        Nothing yet? Check your spam folder. For your security we show this message whether or not the address has an
        account.
      </p>
      <form action={resendAction}>
        {resendFields}
        <button className="btn" type="submit" disabled={left > 0 || pending}>
          {left > 0 ? `Resend link in ${left} s` : pending ? "Sending…" : "Resend link"}
        </button>
      </form>
      {onBack && (
        <button className="link-button" type="button" onClick={onBack}>
          {backLabel}
        </button>
      )}
    </div>
  );
}
