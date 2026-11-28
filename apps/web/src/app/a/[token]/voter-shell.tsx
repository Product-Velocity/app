import type { CSSProperties, ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";

/**
 * The frame of every voting screen (issue #749): a header with the brand, one centred column, roomy type. Used by the personal-link page, the
 * stop-reminders page and the browser test page, so every state of a vote looks the same on a phone and on a desktop.
 * `brand` is how a workspace's own brand replaces the Product Velocity one (issue #750): its name and logo in the header, its colours as CSS
 * variables on the root. Without it the Product Velocity look is used.
 */
export type VoterBrand = {
  name: string;
  /** The logo as a public image address; the name is always shown as live text beside it. */
  logoSrc: string | null;
  /** CSS variables that replace the brand colours on these screens (already checked for contrast). */
  vars?: Record<string, string>;
};

export function VoterShell({ title, eyebrow, children, brand }: { title: string; eyebrow?: string; children: ReactNode; brand?: VoterBrand | null }) {
  return (
    <div className="voter" style={brand?.vars as CSSProperties | undefined}>
      <header className="voter-header">
        <div className="voter-header-inner">
          {brand ? (
            <span className="voter-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {brand.logoSrc && <img src={brand.logoSrc} alt="" className="voter-logo" />}
              <span className="voter-brand-name">{brand.name}</span>
            </span>
          ) : (
            <BrandLogo size={28} />
          )}
        </div>
      </header>
      <main className="voter-main">
        <div className="voter-panel">
          {eyebrow && <p className="voter-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
