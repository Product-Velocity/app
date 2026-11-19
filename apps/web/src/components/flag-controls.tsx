"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { ResolvedFlagAction } from "@pv/domain";

/** The CSS class of an action button: filled for a move or opening the initiative, outlined for a gate request, light for a link to Decisions. */
export function actionClass(a: ResolvedFlagAction): string {
  return a.kind === "gate" ? "chg-act chg-act-gate" : a.kind === "requested" || a.kind === "decisions" ? "chg-act chg-act-requested" : "chg-act";
}

/**
 * What a flag's action looks like and does, in the Actions column and on the flag pill: a link when it goes to another page (Decisions), a button when it does something
 * here (move, request a gate, open the initiative). One component so the grid and the Changes report behave the same.
 */
export function FlagControl({ a, className, busy = false, onRun, children }: { a: ResolvedFlagAction; className: string; busy?: boolean; onRun: () => void; children: ReactNode }) {
  if ("href" in a) return <Link href={a.href} className={className} title={a.title} onClick={(e) => e.stopPropagation()}>{children}</Link>;
  return <button type="button" className={className} title={a.title} disabled={busy} onClick={(e) => { e.stopPropagation(); onRun(); }}>{children}</button>;
}
