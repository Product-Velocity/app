"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinSession, requestNewLink, stopReminders, type LinkResult } from "./actions";

/** One button that runs a link action and shows its answer under it. */
export function LinkButton({ token, action, label, primary = true, refresh = false }: { token: string; action: "join" | "new" | "stop"; label: string; primary?: boolean; refresh?: boolean }) {
  const [result, setResult] = useState<LinkResult>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = () => start(async () => {
    const r = await (action === "join" ? joinSession(token) : action === "new" ? requestNewLink(token) : stopReminders(token));
    setResult(r);
    if (refresh && r?.ok) router.refresh();
  });
  return (
    <div className="stack">
      <div><button className={primary ? "btn btn-primary" : "btn"} type="button" onClick={run} disabled={pending || (!!result?.ok && action !== "join")}>{pending ? "One moment…" : label}</button></div>
      {result?.ok && action !== "join" && <p role="status" className="notice">{result.ok}</p>}
      {result?.error && <p role="alert" className="error">{result.error}</p>}
    </div>
  );
}
