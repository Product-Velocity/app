"use client";

import Link from "next/link";
import { useState } from "react";

/** Shown instead of a desktop-only screen on a phone (CSS hides it elsewhere). Never a broken grid. */
export function OpenOnComputer({ what }: { what: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="phone-only open-on-computer" role="note">
      <h2>{what} is for a computer</h2>
      <p>This screen needs a bigger display. On a phone you can search initiatives, review and decide gates, read reports and add a placeholder.</p>
      <div className="inline-form">
        <Link className="btn" href="/cards">Open initiatives</Link>
        <button type="button" className="btn" onClick={copy}>Copy link</button>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(`Product Velocity: ${what}`)}&body=${encodeURIComponent("Open this on a computer when you are ready")}`}>Email me this</a>
      </div>
      {copied && <p role="status" className="muted">Link copied.</p>}
    </div>
  );
}
