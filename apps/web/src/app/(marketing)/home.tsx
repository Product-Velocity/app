import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { EarlyAccessForm } from "./early-access-form";
import {
  ART_AI, ART_ALIGN, ART_CHAIN, ART_HERO, ART_HIER, ART_LAYER, ART_LIFE, ART_LOOP, ART_PILLS, ART_SHEET, ART_VIEWS,
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
          <div className="hl">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 style={{ maxWidth: "18em" }}>{title}</h2>
            {challenge && <p className="challenge"><b>The challenge</b>{challenge}</p>}
          </div>
          <div className="hr">
            {challenge && <div className="how">How Product Velocity helps</div>}
            <p className="body">{body}</p>
            {points && points.length > 0 && <ul className="points">{points.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        </div>
        <div className={`art${klass ? ` ${klass}` : ""}`} aria-hidden="true"><div className="scroll" dangerouslySetInnerHTML={{ __html: art }} /></div>
      </div>
    </section>
  );
}

/** Three examples of working with an AI assistant on the roadmap (example data, wording only; nothing here is a live screen). */
const PRACTICE: { label: string; ask: string; title: string; chips: [string, "info" | "good" | "risk"][]; note: string }[] = [
  { label: "Write", ask: "Draft the PRD for the self-serve onboarding initiative, using what we decided in discovery.", title: "PRD saved on the initiative", chips: [["AI draft", "info"], ["For your review", "risk"]], note: "Drafts are marked as AI drafts until a person accepts them." },
  { label: "Analyse", ask: "The launch is 60 days in. Here is the adoption data from our analytics. How are we doing against the key result?", title: "Outcome review added next to the key result", chips: [["For review", "info"]], note: "Your AI analyses in your own tools. Product Velocity keeps the result with the initiative, its effort and its key result." },
  { label: "Drive", ask: "Prepare the update for leadership and tell me what needs action.", title: "Leadership report ready, 3 flags: 2 decisions waiting, 1 item stuck", chips: [["Ready", "good"], ["Needs action", "risk"]], note: "Reports are built for each audience. Sending needs your confirmation." },
];

function Practice() {
  return (
    <section id="practice" className="sec band">
      <div className="wrap">
        <Eyebrow>In practice</Eyebrow>
        <h2 style={{ maxWidth: "20em" }}>Ask your AI. See it land on the roadmap.</h2>
        <p className="body">Connect Claude, ChatGPT or Gemini and work on the roadmap in plain language. Every change is audited and can be undone, and your AI never approves.</p>
        <div className="prac">
          {PRACTICE.map((c) => (
            <div className="card" key={c.label}>
              <div className="lbl">{c.label}</div>
              <p className="ask">{c.ask}</p>
              <div className="res">
                <b>{c.title}</b>
                <div className="chips">{c.chips.map(([t, k]) => <span key={t} className={`chip ${k}`}>{t}</span>)}</div>
              </div>
              <p className="note">{c.note}</p>
            </div>
          ))}
        </div>
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
            <a href="#why-now">Why</a>
            <a href="#loop">Your AI</a>
            <a href="#not">Product</a>
            <Link className="signin" href="/sign-in">Sign in</Link>
            <a className="btn btn-p" href="#early-access">Join us</a>
          </nav>
        </header>

        <div className="hero" id="top">
          <div className="copy">
            <div className="eyebrow">One source of truth for product managers and their AI</div>
            <h1>{"AI changed the PM's job. Give it one place to work from."}</h1>
            <p className="lead">Product Velocity is the single source of truth where product managers, stakeholders and their AI plan, decide and deliver together. Every initiative in one place, from the company objective to the delivery ticket, on top of Jira and GitHub. Product teams move faster, every stakeholder stays informed, and bigger outcomes get delivered.</p>
            <div className="cta">
              <a className="btn btn-p" href="#early-access">Join us</a>
              <Link className="btn btn-s" href="/demo">See the demo</Link>
              <a className="btn btn-s" href="#why-now">See how it works</a>
            </div>
            <p className="trust muted">The demo opens a real, read-only example workspace (Meridian Media) &ndash; nothing you click there is saved.</p>
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

      <Split id="why-now" eyebrow="Why now" title="AI does more of the work. The PM raises the bar."
        challenge="AI drafts, analyses and prepares, but it cannot make the critical calls on its own. It does not know your customers, your stakeholders or your trade-offs."
        body="Product managers are the bar raisers. They connect the dots, fill the gaps and turn what AI produces into bigger outcomes, faster. That means driving decisions across stakeholder groups and taking deeper insight back to leadership. Product Velocity is where that work happens, with people and their AI on the same roadmap."
        points={["AI drafts, analyses and prepares", "You decide, align and drive", "Leadership gets deeper insight, sooner"]}
        art={ART_AI} />

      <Split id="source" band flip eyebrow="One source of truth" title="Documents, statuses and priorities do not live in a vacuum"
        challenge="Most of us start in a spreadsheet. It works, until it is too wide to share across a group of PMs, unreadable for stakeholders, too big for AI to make sense of after a few quarters, and cut off from your delivery trackers."
        body="Every PRD, priority, decision and result needs the objective above it, the delivery work below it and the stakeholders around it. Product Velocity keeps that context in one structured place, and every AI assistant you connect works from the same, always current picture."
        points={["Shared by every PM on the team", "Readable for stakeholders and leadership, in a view for each audience", "Structured so AI can read it, however many quarters you add", "Synced with Jira and GitHub, so nothing is copied by hand"]}
        art={ART_SHEET} />

      <Split id="loop" eyebrow="Work with your AI" title="Your AI writes, analyses and drives. Product Velocity remembers."
        challenge="Every AI assistant starts cold, and what it produces stays in a chat."
        body="Connect Claude, ChatGPT or Gemini to your roadmap and every session starts from the same, current context. Your AI helps shape the opportunity and the business case, and after launch it analyses the results and brings them back, so the next decision starts from evidence. We do not sell tokens. Bring the AI you already use."
        points={["Decide: your AI writes the PRD, discovery and gate pack as drafts, and people decide at the gates", "Deliver: your AI creates and updates initiatives, and epics and stories go to Jira and GitHub after you confirm", "Learn: your AI analyses the results in your own tools and brings them back, next to the initiative, its effort and key result", "Product Velocity reports and flags what needs action, such as stuck work and waiting decisions"]}
        art={ART_LOOP} />

      <Practice />

      <Split id="not" band flip eyebrow="What it is, and what it is not" title="Not another Jira. The layer on top."
        challenge="Objectives, OKRs, go-to-market plans, outcomes and time to market live in disconnected docs, slides and sheets, and nobody has the full picture."
        body="Product Velocity sits on top of the tools your engineers already use. It hosts the data layer for everything around delivery: company objectives and OKRs, go-to-market, outcomes and velocity from idea to launch. Jira and GitHub keep tracking tickets and code. Product Velocity brings your delivery tools, your alignment process and your AI together, and keeps the context that connects them."
        points={["Works alongside Jira and GitHub and does not replace them", "Commercial data stays in Product Velocity and never goes to the delivery tools", "Velocity means time to market, followed across the whole lifecycle"]}
        art={ART_LAYER} />

      <Split id="views" eyebrow="Teams move faster" title="One line item for every initiative"
        challenge="Roadmaps live in spreadsheets, slides and different trackers. Every update means rebuilding the picture by hand."
        body="Every initiative is a line item in one fast grid, across every team and business line. Build a view on top for each stakeholder, and everyone sees what they need to know from the same data."
        points={["Built for speed: add, edit and rank from the keyboard", "Views for leadership, teams and delivery on one dataset", "Paste in from Excel to get started"]}
        art={ART_VIEWS} />

      <Split id="transparency" band flip eyebrow="Everyone stays informed" title="Full transparency, from leadership report to Jira ticket"
        challenge="Leaders ask for updates, teams write them, and the answer is out of date by the time it arrives."
        body="What is being built, why, by whom and when, in the same data and in real time. Leaders read the summary. Teams open the detail. Your engineers keep working in Jira and GitHub, and the progress comes up to the roadmap. Nobody waits for an update."
        points={["Live progress from Jira and GitHub", "Reports for each audience", "Reports and flags for what needs action, such as stuck work or a decision that is waiting"]}
        art={ART_CHAIN} />

      <Wide id="solution" eyebrow="Bigger outcomes get delivered" title="From strategy to OKR to tracked outcomes, on one roadmap" klass="hier"
        challenge="Shipped gets treated as done, and the link back to the company objective gets lost."
        body="Company objectives and business lines sit at the top. Below them are outcomes, focus areas and groups, then the initiatives that carry key results and link to the delivery tickets. Each level is data in the same roadmap, so what leadership sees and what engineers build are the same thing. After launch, adoption is tracked at 30, 60 and 90 days before an initiative counts as completed."
        points={["Set the key result, track it, review the outcome", "Your AI can analyse the results and bring them back for people to review", "Completed means the outcome is in", "Results feed the next plan"]}
        art={ART_HIER} />

      <Split id="align" band flip eyebrow="Prioritise and plan with confidence" title="Align stakeholders on what comes first, then plan within capacity"
        challenge="Priorities are argued in meetings, the loudest voice wins, and plans ignore what teams can actually take on."
        body="Invite groups of stakeholders to rank and vote with the method that fits. Results are anonymous, groups are combined fairly, and the outcome feeds one global stack rank. A fit line shows what each team has room for, so plans match capacity."
        points={["Top-5 with duels, 100 coins or ICE scoring", "Stakeholders join by link, with no account needed", "Anonymous results, with small groups kept private", "One stack rank with a capacity fit line per team"]}
        art={ART_ALIGN} />

      <Wide id="lifecycle" eyebrow="Aligned on decisions" title="From idea to tracked outcome, with decisions on the record"
        challenge="Priorities get argued in meetings and decisions get lost."
        body="Seven phases and three gates give every initiative a path. Rank and vote with the method that fits. A person decides at each gate, and the reason is kept. The process fits the initiative, so small, low-risk work takes a lighter path."
        points={["Your AI prepares gate packs that show what is ready to pass", "Go, go with conditions, hold or stop, with the reason on record", "Stuck work and waiting decisions are flagged"]}
        art={ART_LIFE} />

      <section className="close blue" id="early-access">
        <div className="pt pt-close" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART_PILLS }} />
        <div className="wrap signup">
          <div>
            <Eyebrow>From product people, for product people</Eyebrow>
            <h2>Built by product leaders, for product leaders</h2>
            <p className="body" style={{ fontSize: 18, lineHeight: "28px", maxWidth: "28em", marginTop: 20 }}>We are a group of product leaders working for different companies, managing large and small product teams. We adopted AI in our work and found that something was missing on top: the missing layer. So we started building and exchanging our own tools and best practices. Product Velocity is the outcome.</p>
            <p className="body" style={{ fontSize: 18, lineHeight: "28px", maxWidth: "28em", marginTop: 16 }}>Product Velocity is not a business model. Our goal is not the product itself: it is a tool that helps us in our daily work, driving outcomes, managing roadmaps and teams, and delivering the best outcomes, fully aligned and fast.</p>
            <p className="body" style={{ fontSize: 18, lineHeight: "28px", maxWidth: "28em", marginTop: 16 }}><b>Want to join us?</b> If you are a product person who wants to use it, shape it or share your own tools and practices, leave your details and we will be in touch.</p>
          </div>
          <EarlyAccessForm />
        </div>
      </section>

      <div className="wrap">
        <footer>
          <Link className="brandmark" href="/" aria-label="Product Velocity"><BrandLogo size={28} /></Link>
          <span>From product people, for product people.</span>
          <span><Link href="/sign-in">Sign in</Link> · <Link href="/connector">Connect Claude</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Contact</Link></span>
          <span>Screens shown are wireframes with example data.</span>
        </footer>
      </div>
    </div>
  );
}
