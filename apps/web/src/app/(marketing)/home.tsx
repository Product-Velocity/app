import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { EarlyAccessForm } from "./early-access-form";
import {
  PV2_ALIGN, PV2_LIFECYCLE, PV2_LOOP, PV2_NOT, PV2_PILL_RECTS, PV2_PROOF, PV2_REPORTS, PV2_SOLUTION, PV2_SOURCE, PV2_STAGE, PV2_TRANSPARENCY,
  PV2_VIEWS_TEXT, PV2_WHY_NOW,
} from "./art-v2";
import { GoogleTagManager, GoogleTagManagerNoscript, HOME_JSON_LD } from "./seo";
import { ViewTabs } from "./view-tabs";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./marketing-v2.css";

/** The Claude connector's listing in the Claude directory (docs/decisions/2026-11-17-connector-directory.md). */
export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/connectors/product-velocity";

/**
 * The public homepage (issue #574; prototype in claude.ai artifact 118aa47f). Copy follows the brand guide's claims rules: no competitor
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
            <a href="#why-now">Why now</a>
            <a href="#loop">Your AI</a>
            <a href="#not">Product</a>
            {viewer ? <Link href="/app">{appLabel}</Link> : <Link href="/sign-in">Sign in</Link>}
          </nav>
          <div className="btns">
            {!viewer && <Link className="btn" href="/demo">See the demo</Link>}
            <a className="btn p" href="#early-access">Join us</a>
          </div>
        </header>

        <section className="hero" id="top">
          <Pills className="pillbg" />
          <span className="eyebrow">Agentic product management platform</span>
          <h1>Deliver bigger, better outcomes. Faster.</h1>
          <p className="lead">The single source of truth where product managers, stakeholders and their AI plan, decide and deliver together. From OKRs to tracked outcomes, on one roadmap for humans and AI.</p>
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
        <Static html={PV2_PROOF} />
        <Static html={PV2_WHY_NOW} />
        <Static html={PV2_SOURCE} />
        <Static html={PV2_LOOP} />
        <Static html={PV2_NOT} />
        <section className="why flip" id="views">
          <Static html={PV2_VIEWS_TEXT} />
          <ViewTabs />
        </section>
        <Static html={PV2_TRANSPARENCY} />
        <Static html={PV2_SOLUTION} />
        <Static html={PV2_ALIGN} />
        <Static html={PV2_LIFECYCLE} />
        <Static html={PV2_REPORTS} />

        <section className="close" id="early-access">
          <Pills className="ptw" />
          <div className="signup">
            <div>
              <span className="eyebrow">Join us</span>
              <h2>From product people, for product people.</h2>
              <p>We are a group of product leaders working for different companies, managing large and small product teams. We adopted AI in our work and found that something was missing on top: the missing layer. Product Velocity is the tool we built for our own daily work. It is not a business model.</p>
              <p><b>Want to join us?</b> If you are a product person who wants to use it, shape it or share your own tools and practices, leave your details and we will be in touch.</p>
            </div>
            <EarlyAccessForm />
          </div>
        </section>

        <footer>
          <Link className="logo" href="/" aria-label="Product Velocity"><BrandLogo size={28} /></Link>
          <span>From product people, for product people.</span>
          <span>
            {viewer ? <Link href="/app">{appLabel}</Link> : <Link href="/sign-in">Sign in</Link>} · <Link href="/connector">Connect Claude</Link> · <a href={CLAUDE_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">Claude directory</a> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Contact</Link>
          </span>
          <span>Product pictures are mock-ups with example data (tenant Meridian Media).</span>
        </footer>
      </div>
    </div>
  );
}
