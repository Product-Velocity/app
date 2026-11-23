import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { EarlyAccessForm } from "./early-access-form";
import { PV2_CHANGES, PV2_HOW, PV2_PILL_RECTS, PV2_PROBLEM, PV2_STAGE, PV2_TRUST, PV2_VELOCITY, PV2_WHAT, pv2Prog } from "./art-v2";
import { MobileMenu } from "./mobile-menu";
import { UseCases } from "./use-cases";
import { GoogleTagManager, GoogleTagManagerNoscript, HOME_JSON_LD } from "./seo";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./marketing-v2.css";

/** The Claude connector's listing in the Claude directory (docs/decisions/2026-11-17-connector-directory.md). */
export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/connectors/product-velocity";

/**
 * The public homepage (issues #574, #578; prototype in claude.ai artifact 5u5phLvmat1UmtJNS3vJBU). Copy follows the brand guide's claims rules: no competitor
 * claims, every statement true of the product today, example data only, Claude named only where it is verified. The product pictures are
 * mock-ups with example data (tenant "Meridian Media"), not screenshots. The previous homepage stays at /classic (home-classic.tsx).
 */
function Static({ html, className }: { html: string; className?: string }) {
  // static markup from art-v2.ts, never user input
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} style={className ? undefined : { display: "contents" }} />;
}

function Pills({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 256 256" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: PV2_PILL_RECTS }} />;
}

const SYNC_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3-3M20 15H7l3 3" /></svg>;
const AI_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>;

/** `viewer` is how the visitor is signed in: not at all, as a member of a workspace, or in the shared demo account. */
export function Home({ viewer = null }: { viewer?: "member" | "demo" | null }) {
  const appLabel = viewer === "demo" ? "Back to the demo" : "Open app";
  return (
    <div className="pv2">
      <GoogleTagManager />
      <GoogleTagManagerNoscript />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_JSON_LD) }} />
      <div className="page">
        <header>
          <Link className="logo" href="/" aria-label="Product Velocity"><BrandLogo size={45} /></Link>
          <nav aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#usecases">Use cases</a>
            <a href="#velocity">Velocity</a>
            <a href="#trust">Trust</a>
          </nav>
          <div className="btns">
            {viewer !== "member" && <Link className="btn" href="/sign-in">Sign in</Link>}
            {viewer ? <Link className="btn" href="/app">{appLabel}</Link> : <Link className="btn" href="/demo">See the demo</Link>}
            <a className="btn p" href="#early-access">Join us</a>
            <MobileMenu>
              {viewer ? <Link href="/app">{appLabel}</Link> : <Link href="/demo">See the demo</Link>}
              {viewer !== "member" && <Link href="/sign-in">Sign in</Link>}
            </MobileMenu>
          </div>
        </header>

        <section className="hero" id="top">
          <Pills className="pillbg" />
          <span className="eyebrow">Agentic product management platform</span>
          <h1>Deliver bigger, better outcomes. Faster.</h1>
          <p className="lead">As engineering speeds up with agents, the bottleneck moves to what to build and how fast you can decide. Product Velocity gives product managers and their AI co-workers one roadmap and the real business context behind it, from company OKRs to tracked outcome, across business lines, PM scopes and teams. AI prepares, people decide.</p>
          <div className="cta">
            <a className="btn p big" href="#early-access">Join us</a>
            {viewer ? <Link className="btn big" href="/app">{appLabel}</Link> : <Link className="btn big" href="/demo">See the demo</Link>}
          </div>
          <div className="works">
            <span>{SYNC_ICON}Two-way sync with Jira and GitHub</span>
            <span>{AI_ICON}Connect Claude, ChatGPT and Gemini</span>
          </div>
          {!viewer && <p className="works">The demo opens a read-only example workspace (Meridian Media). Nothing you click there is saved.</p>}
        </section>

        <Static html={PV2_STAGE} />
        <Static html={PV2_PROBLEM} />
        <Static html={PV2_WHAT} />
        <Static html={PV2_HOW} />
        <UseCases />
        <Static html={PV2_VELOCITY} />
        <Static html={PV2_CHANGES} />
        <Static html={PV2_TRUST} />

        <section className="close" id="early-access">
          <Pills className="ptw" />
          <div className="prog" data-n="8" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pv2Prog(8) }} />
          <div className="signup">
            <div>
              <span className="eyebrow">Join us</span>
              <h2>From product people, for product people.</h2>
              <p>We are a group of product leaders working for different companies, managing large and small product teams. Product Velocity is the tool we built for our own daily work. It is not a business model.</p>
              <p><b>Want to join us?</b> If you are a product person who wants to use it, shape it or share your own tools and practices, leave your details and we will be in touch.</p>
            </div>
            <EarlyAccessForm />
          </div>
        </section>

        <footer>
          <Link className="logo" href="/" aria-label="Product Velocity"><BrandLogo size={28} /></Link>
          <span>From product people, for product people.</span>
          <span>
            {viewer ? <Link href="/app">{appLabel}</Link> : null}{viewer ? " · " : null}{viewer !== "member" && <Link href="/sign-in">Sign in</Link>} · <Link href="/connector">Connect Claude</Link> · <a href={CLAUDE_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">Claude directory</a> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Contact</Link>
          </span>
          <span>Product pictures are mock-ups with example data (tenant Meridian Media).</span>
        </footer>
      </div>
    </div>
  );
}
