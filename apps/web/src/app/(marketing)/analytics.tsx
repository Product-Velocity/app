"use client";

import { useEffect, useState } from "react";

/** Homepage analytics in the browser: a consent banner and button-click events for Google Tag Manager (issue #682).
 *  Only `analytics_storage` is ever granted; ad storage, ad user data and personalisation stay denied. */
const KEY = "pv-analytics-consent";

type Choice = "granted" | "denied";
type Gtag = (...args: unknown[]) => void;
type W = Window & { dataLayer?: unknown[] };

/** Which button a link is, from where it goes. Not from its wording, so a copy change cannot break the report. */
export function ctaName(href: string | null): string | null {
  if (!href) return null;
  if (href === "/demo") return "see_demo";
  if (href === "/sign-in") return "sign_in";
  if (href === "/app") return "open_app";
  if (href === "#early-access") return "join_us";
  if (href === "/connector") return "connect_claude";
  if (/^https:\/\/claude\.ai\/directory\//.test(href)) return "claude_directory";
  return null;
}

/** Where on the page a button sits. */
export function ctaLocation(el: Element): string {
  if (el.closest("header")) return "header";
  if (el.closest("footer")) return "footer";
  if (el.closest(".hero")) return "hero";
  if (el.closest("#early-access")) return "join_section";
  return "page";
}

function push(...args: unknown[]) {
  const w = window as W;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(args as unknown as never);
}

function readChoice(): Choice | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch { return null; }
}

function applyChoice(c: Choice) {
  // Same call shape as gtag(): GTM reads `arguments` objects pushed to the data layer.
  const w = window as W;
  w.dataLayer = w.dataLayer || [];
  const dl = w.dataLayer;
  // GTM only understands the `arguments` object that gtag() pushes, not an array, so rest parameters will not do.
  // eslint-disable-next-line prefer-rest-params
  const gtag: Gtag = function () { dl.push(arguments); };
  gtag("consent", "update", { analytics_storage: c });
}

export function Analytics() {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const saved = readChoice();
    if (saved) applyChoice(saved); else setAsking(true); // eslint-disable-line react-hooks/set-state-in-effect -- the saved choice lives in the browser, so it can only be read after the page has loaded

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const cta = a.getAttribute("data-cta") || ctaName(a.getAttribute("href"));
      if (!cta) return;
      push({ event: "cta_click", cta, cta_location: ctaLocation(a) });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function choose(c: Choice) {
    try { window.localStorage.setItem(KEY, c); } catch { /* the choice then lasts for this visit only */ }
    applyChoice(c);
    setAsking(false);
  }

  if (!asking) return null;
  const btn = { font: "500 14px system-ui, sans-serif", padding: "9px 16px", borderRadius: 999, cursor: "pointer", border: "1px solid #2270ED" } as const;
  return (
    <div role="region" aria-label="Cookie choice" style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 1000, maxWidth: 560, margin: "0 auto", background: "#fff", color: "#1a1a1a", border: "1px solid #d0d5dd", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,.15)", padding: 16, font: "14px/1.45 system-ui, sans-serif" }}>
      <p style={{ margin: "0 0 12px" }}>We would like to use an analytics cookie to count visits to this page. It is off unless you accept, and we use no advertising cookies. <a href="/privacy" style={{ color: "#1A56C4" }}>Privacy</a></p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => choose("granted")} style={{ ...btn, background: "#2270ED", color: "#fff" }}>Accept</button>
        <button type="button" onClick={() => choose("denied")} style={{ ...btn, background: "#fff", color: "#1A56C4" }}>Decline</button>
      </div>
    </div>
  );
}
