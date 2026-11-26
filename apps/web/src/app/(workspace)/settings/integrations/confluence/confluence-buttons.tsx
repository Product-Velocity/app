"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A submit button that says it is working while its form's action runs (a test or a sign-in can take several seconds), and cannot be pressed twice. */
export function PendingButton({ label, pendingLabel, className = "btn", disabled = false }: { label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={disabled || pending} aria-busy={pending}>{pending ? pendingLabel : label}</button>;
}

/**
 * The outcome of an action, shown next to the buttons that caused it: it scrolls into view and takes focus when it appears, so it cannot be missed
 * (a failure is announced as an alert, a success as a status).
 */
export function ResultBox({ kind, children }: { kind: "ok" | "fail"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} tabIndex={-1} role={kind === "fail" ? "alert" : "status"} className={kind === "ok" ? "result result-ok" : "result result-fail"}>{children}</div>;
}
