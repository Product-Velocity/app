"use client";

import { useState, useTransition } from "react";
import { confirmEnrollment, startEnrollment } from "./actions";

type Started = { factorId: string; qr: string; secret: string };

export function EnrollTotp() {
  const [started, setStarted] = useState<Started | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack">
      {!started && (
        <button
          className="btn btn-primary"
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await startEnrollment();
              if ("error" in r) setMessage({ kind: "error", text: r.error });
              else {
                setMessage(null);
                setStarted(r);
              }
            })
          }
        >
          Set up authenticator app
        </button>
      )}
      {started && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code") ?? "");
            startTransition(async () => {
              const r = await confirmEnrollment(started.factorId, code);
              if (r.ok) {
                setStarted(null);
                setMessage({ kind: "ok", text: "Two-factor sign-in is on." });
              } else setMessage({ kind: "error", text: r.error });
            });
          }}
        >
          <p>
            Scan this QR code with an authenticator app (such as 1Password, Authy or Google
            Authenticator), then enter the 6-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={started.qr} alt="QR code for your authenticator app" width={176} height={176} />
          <p className="muted">
            Cannot scan? Enter this key by hand: <code>{started.secret}</code>
          </p>
          <div className="field">
            <label htmlFor="totp-code">Code from the app</label>
            <input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Turn on"}
          </button>
        </form>
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : "success"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
