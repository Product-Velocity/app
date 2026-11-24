/**
 * Help figures (issue #646). Drawn in markup, not images: they follow the theme, scale, and each carries a text alternative.
 * Every figure is labelled as example data. Nothing here is read from a workspace.
 */
import { GATES_OUTCOMES } from "../help-content";

const Ex = () => <span className="hp-fig-ex">Example data</span>;

/** The decision dialog of a gate: four outcomes, an optional comment, a person decides. */
export function GateDecideFigure() {
  const outcomes = GATES_OUTCOMES.rows;
  return (
    <figure className="hp-fig" aria-label="The Decide dialog at a gate: choose Go, Go with conditions, Hold or Stop, add an optional comment, then Decide. The reason is kept as written.">
      <div className="hp-fig-bar"><b>Gate B: Define to Build</b><Ex /></div>
      <div className="hp-fig-body">
        <p className="hp-fig-who">Decided by a person with approval rights. An AI co-worker only prepares the gate pack.</p>
        <ul className="hp-fig-choices">{outcomes.map(([n, t]) => <li key={n}><b>{n}</b><span>{t}</span></li>)}</ul>
        <p className="hp-fig-field">Comment (optional): kept as written, never edited</p>
        <p className="hp-fig-btns"><span className="hp-fig-btn hp-fig-btn-main">Decide</span><span className="hp-fig-btn">Cancel</span></p>
      </div>
    </figure>
  );
}

/** Anonymous alignment results by group, with a group of fewer than five voters hidden. */
export function AnonymityFigure() {
  const rows: [string, number | null][] = [["Sales", 12], ["Support", 7], ["Finance", null]];
  return (
    <figure className="hp-fig" aria-label="Alignment results by group: Sales, 12 voters; Support, 7 voters; Finance is hidden because it has fewer than five voters.">
      <div className="hp-fig-bar"><b>Crowd result by group</b><Ex /></div>
      <div className="hp-fig-body">
        {rows.map(([g, n]) => (
          <div key={g} className="hp-fig-row">
            <span className="hp-fig-label">{g}</span>
            {n === null ? <span className="hp-fig-hidden">Hidden: fewer than 5 voters</span> : <><span className="hp-fig-track"><span style={{ width: `${(n / 12) * 100}%` }} /></span><span className="hp-fig-n">{n} voters</span></>}
          </div>
        ))}
        <p className="hp-fig-note">Voters see anonymous results only. Names are never shown for a small group.</p>
      </div>
    </figure>
  );
}

/** What flows between Product Velocity and a tracker, and what never does. */
export function SyncFigure() {
  return (
    <figure className="hp-fig hp-sync" aria-label="Product Velocity sends name, summary, description, hypothesis, a few labels, dates and links to shared documents to GitHub or Jira after you confirm. The tracker sends back status, progress, pull requests, CI, releases, assignees and dates. Value, confidence, customer names, decisions, key results and outcomes never leave Product Velocity.">
      <div className="hp-fig-bar"><b>What flows between Product Velocity and your tracker</b></div>
      <div className="hp-sync-grid">
        <div className="hp-sync-box"><b>Product Velocity</b><span>Roadmap, rank, decisions, goals</span></div>
        <div className="hp-sync-mid">
          <p><b>Out, after you confirm</b>Name, summary, description, hypothesis, a few labels, dates, links to shared documents</p>
          <p><b>Back in, by webhook</b>Status, progress, pull requests, CI, releases, assignees, dates</p>
        </div>
        <div className="hp-sync-box"><b>GitHub or Jira</b><span>Issues and delivery</span></div>
      </div>
      <p className="hp-sync-never"><b>Never leaves Product Velocity</b> Value, confidence, customer names and requests, decisions and their reasons, objectives, key results, outcomes</p>
    </figure>
  );
}

/** Three steps to connect an assistant. */
export function SetupFigure() {
  const steps = [["1", "Copy the address", "The connector address shown above."], ["2", "Add it in your assistant", "As a custom connector, in Claude, ChatGPT or Gemini."], ["3", "Sign in and start", "Sign in with your Product Velocity account, then type pv-help."]];
  return (
    <figure className="hp-fig" aria-label="Three steps: copy the connector address, add it in your assistant as a connector, sign in with your Product Velocity account and type pv-help.">
      <ol className="hp-fig-steps">{steps.map(([n, t, d]) => <li key={n}><span className="hp-docfig-n">{n}</span><span><b>{t}</b><br />{d}</span></li>)}</ol>
    </figure>
  );
}

/** The weekly update as a leadership reader sees it. */
export function WeeklyFigure() {
  return (
    <figure className="hp-fig" aria-label="A weekly update: a headline, then Needs attention and What moved, each statement linked to its initiative. The creator edits it, marks it reviewed and copies it for email. Nothing is sent for you.">
      <div className="hp-fig-bar"><b>Weekly update, week 47</b><Ex /></div>
      <div className="hp-fig-body">
        <p><b>Needs attention</b></p>
        <ul className="hp-list"><li><u>R-12 Checkout redesign</u> is Blocked: waiting on a payments review.</li></ul>
        <p><b>What moved</b></p>
        <ul className="hp-list"><li><u>R-7 Self-service onboarding</u> moved from Test to Roll-out.</li></ul>
        <p className="hp-fig-btns"><span className="hp-fig-btn">Edit</span><span className="hp-fig-btn">Mark reviewed</span><span className="hp-fig-btn hp-fig-btn-main">Copy for email</span></p>
      </div>
    </figure>
  );
}
