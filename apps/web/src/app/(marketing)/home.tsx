import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { EarlyAccessForm } from "./early-access-form";
import {
  ART_AI, ART_ALIGN, ART_CHAIN, ART_HERO, ART_HIER, ART_LAYER, ART_LIFE, ART_ONE, ART_OUTCOME, ART_PILLS, ART_VIEWS,
} from "./art";
import { GoogleTagManager, GoogleTagManagerNoscript, HOME_JSON_LD } from "./seo";
import "./marketing.css";

/** The Claude connector's listing in the Claude directory (docs/decisions/2026-11-17-connector-directory.md). */
export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/connectors/product-velocity";

/**
 * The public homepage at productvelocity.app for signed-out visitors (issue #498). Copy follows the brand guide's claims rules: no
 * competitor claims, every statement true of the product today, example data only, Claude named only where it is verified. The pictures
 * are wireframes (art.ts), not screenshots.
 */
function Art({ svg, className }: { svg: string; className?: string }) {
  // static markup from art.ts, never user input
  return <div className={className ?? "art"} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

type SplitProps = { id: string; eyebrow: string; title: string; challenge: string; body: string; points: string[]; art: string; flip?: boolean; band?: boolean };
function Split({ id, eyebrow, title, challenge, body, points, art, flip, band }: SplitProps) {
  return (
    <section id={id} className={`sec${band ? " band" : ""}`}>
      <div className={`wrap split${flip ? " flip" : ""}`}>
        <div className="txt">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2>{title}</h2>
          <p className="challenge"><b>The challenge</b>{challenge}</p>
          <div className="how">How Product Velocity helps</div>
          <p className="body">{body}</p>
          <ul className="points">{points.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
        <Art svg={art} />
      </div>
    </section>
  );
}

type WideProps = { id: string; eyebrow: string; title: string; challenge?: string; body: string; points?: string[]; art: string; klass?: string; band?: boolean };
function Wide({ id, eyebrow, title, challenge, body, points, art, klass, band }: WideProps) {
  return (
    <section id={id} className={`sec wide${band ? " band" : ""}`}>
      <div className="wrap">
        <div className="head">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 style={{ maxWidth: "18em" }}>{title}</h2>
          {challenge && <p className="challenge"><b>The challenge</b>{challenge}</p>}
          {challenge && <div className="how">How Product Velocity helps</div>}
          <p className="body">{body}</p>
          {points && points.length > 0 && <ul className="points">{points.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
        <div className={`art${klass ? ` ${klass}` : ""}`} aria-hidden="true"><div className="scroll" dangerouslySetInnerHTML={{ __html: art }} /></div>
      </div>
    </section>
  );
}

const SHIELD = (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const BURST_RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * 30 * Math.PI) / 180;
  return `M12 12L${(12 + 10.5 * Math.cos(a)).toFixed(2)} ${(12 + 10.5 * Math.sin(a)).toFixed(2)}`;
});

export function Home() {
  return (
    <div className="mk">
      <GoogleTagManager />
      <GoogleTagManagerNoscript />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_JSON_LD) }} />
      <div className="wrap">
        <header className="top">
          <Link className="brandmark" href="/" aria-label="Product Velocity"><span className="logo-lg"><BrandLogo size={64} /></span><span className="logo-sm"><BrandLogo size={36} /></span></Link>
          <nav className="main" aria-label="Main">
            <a href="#solution">Product</a>
            <a href="#lifecycle">How it works</a>
            <a href="#ai">Your AI</a>
            <Link className="signin" href="/sign-in">Sign in</Link>
            <a className="btn btn-p" href="#early-access">Get early access</a>
          </nav>
        </header>

        <div className="hero" id="top">
          <div className="copy">
            <div className="eyebrow">One roadmap for humans and AI</div>
            <h1>Stop rebuilding the roadmap in slides and sheets</h1>
            <p className="lead">Every initiative in one place, from the company objective to the delivery ticket. Product Velocity sits on top of Jira and GitHub and hosts the objectives, OKRs, go-to-market and outcomes that teams keep in disconnected docs, slides and sheets. Product teams move faster, every stakeholder stays informed, and bigger outcomes get delivered.</p>
            <div className="cta">
              <a className="btn btn-p" href="#early-access">Get early access</a>
              <a className="btn btn-s" href="#solution">See how it works</a>
            </div>
            <p className="trust">{SHIELD}<span>Works alongside Jira and GitHub.</span></p>
            <a className="trust conn" href={CLAUDE_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">{BURST_RAYS.map((d) => <path key={d} d={d} />)}</svg>
              <span>Integrated with Claude</span>
            </a>
          </div>
          <div className="artbox"><Art svg={ART_HERO} /></div>
        </div>
      </div>

      <section className="blue vals">
        <div className="pt pt-blue" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART_PILLS }} />
        <div className="wrap">
          <div className="pillars">
            <div><b>Teams move faster</b><span>One place for the data, so nobody rebuilds the same picture in five tools.</span></div>
            <div><b>Everyone stays informed</b><span>Leaders, teams and customers see the same roadmap, in the view that suits them.</span></div>
            <div><b>Bigger outcomes get delivered</b><span>Every initiative carries the objective it serves and the result it should move.</span></div>
          </div>
        </div>
      </section>

      <section className="story">
        <div className="wrap">
          <Eyebrow>Why now</Eyebrow>
          <h2>AI is changing the product manager&rsquo;s job</h2>
          <p className="body" style={{ fontSize: 20, lineHeight: "30px", color: "var(--ink-muted)", maxWidth: "34em", marginTop: 20 }}>Less time goes to documents, updates and analysis. More goes to the work that matters: clearer and bigger outcomes, faster delivery, and every stakeholder informed and aligned. Product Velocity is where that work happens, on one roadmap that people and their AI co-workers both work from.</p>
          <Art svg={ART_ONE} />
        </div>
      </section>

      <Wide id="solution" eyebrow="The solution" title="Every initiative in one place, from the company objective to the delivery ticket" band klass="hier"
        body="Company objectives and business lines sit at the top. Below them are outcomes, focus areas and groups, then the initiatives that carry key results and link to the delivery tickets. Each level is data in the same roadmap, so what leadership sees and what engineers build are the same thing. It sits on top of your delivery tools."
        art={ART_HIER} />

      <Split id="not" flip eyebrow="What it is, and what it is not" title="Not another delivery tracker. The layer on top."
        challenge="Objectives, OKRs, go-to-market plans, outcomes and time to market live in disconnected docs, slides and sheets, and nobody has the full picture."
        body="Product Velocity sits on top of the tools your engineers already use. It hosts the data layer for everything around delivery: company objectives and OKRs, go-to-market, outcomes and velocity from idea to launch. Jira and GitHub keep tracking tickets and code. Product Velocity brings the rest together."
        points={["Works alongside Jira and GitHub and does not replace them", "Commercial data stays in Product Velocity and never goes to the delivery tools", "Velocity means time to market, followed across the whole lifecycle"]}
        art={ART_LAYER} />

      <section className="blue usps-band">
        <div className="wrap">
          <Eyebrow>How it comes together</Eyebrow>
          <div className="usps" aria-label="Key benefits" style={{ marginTop: 24 }}>
            <div><b>Clarity</b><span>One roadmap for every team and business line, from idea to completed roll-out.</span></div>
            <div><b>Transparency</b><span>What, why, who and when, from leadership and stakeholder reports to Jira tickets.</span></div>
            <div><b>Alignment</b><span>Stakeholders rank and vote, and plans fit capacity.</span></div>
            <div><b>Impact</b><span>Objectives and key results tracked on every initiative.</span></div>
            <div><b>Your own AI</b><span>Bring your own AI, we do not sell tokens.</span></div>
          </div>
        </div>
      </section>

      <Split id="views" band eyebrow="Teams move faster" title="One line-item roadmap for every team"
        challenge="Roadmaps live in spreadsheets, slides and different trackers. Every update means rebuilding the picture by hand."
        body="Every initiative is a line item in one fast grid, across every team and business line. Build a view on top for each stakeholder, and everyone sees what they need to know from the same data."
        points={["Built for speed: add, edit and rank from the keyboard", "Views for leadership, teams and delivery on one dataset", "Paste in from Excel to get started"]}
        art={ART_VIEWS} />

      <Split id="transparency" flip eyebrow="Everyone stays informed" title="Full transparency, from leadership report to Jira ticket"
        challenge="Leaders ask for updates, teams write them, and the answer is out of date by the time it arrives."
        body="What is being built, why, by whom and when, in the same data and in real time. Leaders read the summary. Teams open the detail. Your engineers keep working in Jira and GitHub, and the progress comes up to the roadmap. Nobody waits for an update."
        points={["Live progress from Jira and GitHub", "Reports for each audience", "Alerts when work is stuck or waiting for a decision"]}
        art={ART_CHAIN} />

      <Split id="outcomes" band eyebrow="Bigger outcomes get delivered" title="From company objectives to tracked results"
        challenge="Shipped gets treated as done, and the link back to the company objective gets lost."
        body="Every initiative sits under a company objective and a business line, and carries the key result it should move. After launch, adoption is tracked at 30, 60 and 90 days before an initiative counts as completed."
        points={["Set the key result, track it, review the outcome", "Completed means the outcome is in", "Results feed the next plan"]}
        art={ART_OUTCOME} />

      <Split id="align" flip eyebrow="Prioritise and plan with confidence" title="Align stakeholders on what comes first, then plan within capacity"
        challenge="Priorities are argued in meetings, the loudest voice wins, and plans ignore what teams can actually take on."
        body="Invite groups of stakeholders to rank and vote with the method that fits. Results are anonymous, groups are combined fairly, and the outcome feeds one global stack rank. A fit line shows what each team has room for, so plans match capacity."
        points={["Top-5 with duels, 100 coins or ICE scoring", "Stakeholders join by link, with no account needed", "Anonymous results, with small groups kept private", "One stack rank with a capacity fit line per team"]}
        art={ART_ALIGN} />

      <Wide id="lifecycle" band eyebrow="Aligned on decisions" title="From idea to tracked outcome, with decisions on the record"
        challenge="Priorities get argued in meetings and decisions get lost."
        body="Seven phases and three gates give every initiative a path. Rank and vote with the method that fits. A person decides at each gate, and the reason is kept. The process fits the initiative, so small, low-risk work takes a lighter path."
        points={["Gate packs show what is ready to pass", "Go, go with conditions, hold or stop, with the reason on record", "Stuck work and waiting decisions are flagged"]}
        art={ART_LIFE} />

      <Split id="ai" flip eyebrow="Your own AI" title="Bring the AI you already use"
        challenge="AI helps one person at a time, in tools that do not know your roadmap."
        body="Create initiatives, write documents, run analysis and prepare reports with your own AI assistant, such as Claude, working on the same roadmap as your team. We do not sell tokens. AI co-workers prepare the work. People decide."
        points={["Drafts from AI are marked as drafts", "No AI approves a gate", "Every change is audited and can be undone"]}
        art={ART_AI} />

      <section className="close blue" id="early-access">
        <div className="pt pt-close" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART_PILLS }} />
        <div className="wrap signup">
          <div>
            <Eyebrow>Early access</Eyebrow>
            <h2>Give your product organisation one roadmap</h2>
            <p className="body" style={{ fontSize: 18, lineHeight: "28px", maxWidth: "28em", marginTop: 20 }}>We are opening early access to product teams that want to move faster, with more transparency and bigger outcomes. Leave your details and we will be in touch.</p>
          </div>
          <EarlyAccessForm />
        </div>
      </section>

      <div className="wrap">
        <footer>
          <Link className="brandmark" href="/" aria-label="Product Velocity"><BrandLogo size={28} /></Link>
          <span>One roadmap for humans and AI.</span>
          <span><Link href="/sign-in">Sign in</Link> · <Link href="/connector">Connect Claude</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Contact</Link></span>
          <span>Screens shown are wireframes with example data.</span>
        </footer>
      </div>
    </div>
  );
}
