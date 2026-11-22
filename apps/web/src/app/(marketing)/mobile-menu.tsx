"use client";
import { useEffect, useState, type ReactNode } from "react";

/** The header menu under 860px: every chapter, plus the sign-in and demo links passed in by the page. Hidden on wide screens by CSS. */
export function MobileMenu({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <button type="button" className="burger" aria-label="Menu" aria-expanded={open} aria-controls="mm" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="mm" id="mm" hidden={!open} onClick={(e) => { if ((e.target as HTMLElement).tagName === "A") setOpen(false); }}>
        <a href="#problem">1 The problem</a>
        <a href="#what">2 What it is</a>
        <a href="#how">3 How it works</a>
        <a href="#usecases">4 Use cases</a>
        <a href="#velocity">5 Velocity and reporting</a>
        <a href="#changes">6 What changes</a>
        <a href="#trust">7 Trust</a>
        <a href="#early-access">8 Join us</a>
        {children}
      </div>
    </>
  );
}
