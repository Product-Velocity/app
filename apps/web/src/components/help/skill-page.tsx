import Link from "next/link";
import { DISCOVERY_SECTIONS, PRD_CORE, PRD_MODULES, PROFILE_SECTIONS, SKILLS, SKILL_PLANS, SKILL_STAGE_LABEL, SKILL_TIER_SHORT, docKindLabel, type SkillSpec } from "@pv/domain";
import { HelpCallout, HelpList, HelpPage, HelpSection } from "./help-ui";
import { DocOutlineFigure, HELP_SKILL_COMMANDS, SkillDocFigure, SkillKindMap, SkillStartFigure, skillBrief, skillFieldNames, skillKind, skillPath } from "./skill-figures";

const worksOn = (s: SkillSpec) =>
  s.output === "advice" ? "Your situation, in your own words" : s.focus ? "The whole workspace, or only the initiatives you name (codes, a range such as R-1 to R-5, a view or a group)" : s.target === "none" ? "The whole workspace; no initiative needed" : s.target === "items" ? "Several initiatives" : "One initiative (a code such as R-12)";

const youGet = (s: SkillSpec) =>
  s.output === "advice" ? "Advice in the chat. Nothing is saved."
  : s.output === "report" ? "A report in the format you choose (email, slides, document, Slack message or the chat). Nothing is saved or sent unless you ask for a copy."
  : s.target === "none" ? `A ${docKindLabel(s.doc.kind)} document in Documents, marked as an AI draft until a person accepts it.`
  : `A ${docKindLabel(s.doc.kind)} document on the initiative's Spec tab, marked as an AI draft until a person accepts it.`;

const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const Link2 = ({ c }: { c: string }) => <Link href={skillPath(c)}>{c}</Link>;
const joinLinks = (cs: readonly string[]) => cs.map((c, i) => <span key={c}>{i > 0 ? ", " : ""}<Link2 c={c} /></span>);

/** What a guided skill runs as steps: always, offered, per gate, with the note on how a step differs here. Read from the plan data. */
function RunsInside({ command }: { command: string }) {
  const inc = SKILL_PLANS[command]?.includes;
  if (!inc) return null;
  const all = [...inc.always, ...inc.offered, ...Object.values(inc.byGate ?? {}).flatMap((l) => l ?? [])];
  if (all.length === 0) return null;
  const notes = Object.entries(inc.notes ?? {}).filter(([c]) => all.includes(c));
  return (
    <HelpSection id="inside" title="What runs inside it">
      <p>A guided skill shows its plan first, then asks once whether you want quick or full. The building blocks below run as steps of one document; you can skip any offered step.</p>
      <dl className="hp-runs">
        {inc.always.length > 0 && <><dt>Always runs</dt><dd>{joinLinks(inc.always)}</dd></>}
        {inc.offered.length > 0 && <><dt>Offered in the full version, skippable</dt><dd>{joinLinks(inc.offered)}</dd></>}
        {(["A", "B", "C"] as const).map((g) => (inc.byGate?.[g] ?? []).length > 0 ? <div key={g}><dt>At Gate {g}</dt><dd>{joinLinks(inc.byGate![g]!)}</dd></div> : null)}
        {notes.length > 0 && <><dt>How a step differs here</dt><dd>{notes.map(([c, n]) => <span key={c}><Link2 c={c} />: {n}. </span>)}</dd></>}
      </dl>
    </HelpSection>
  );
}

function Pager({ command }: { command: string }) {
  const i = HELP_SKILL_COMMANDS.indexOf(command);
  const prev = HELP_SKILL_COMMANDS[i - 1];
  const next = HELP_SKILL_COMMANDS[i + 1];
  return (
    <nav className="hp-pager" aria-label="Other skills">
      {prev ? <Link href={skillPath(prev)}>&larr; {prev}</Link> : <span />}
      {next ? <Link href={skillPath(next)}>{next} &rarr;</Link> : <span />}
    </nav>
  );
}

const KindLine = ({ command }: { command: string }) => {
  const k = skillKind(command);
  const st = skillBrief(command).stage;
  return <p className="hp-where"><span>Kind</span> {k ? cap1(SKILL_TIER_SHORT[k]) : "Skill"}{st ? <> · <span>Stage</span> {SKILL_STAGE_LABEL[st]}</> : null} · <Link href="/help/skills">All skills</Link></p>;
};

/** The three guided flows that are not catalogue entries: their own wording, with outlines read from the templates they write. */
const GUIDED: Record<string, { arg: string; works: string; asks: string[]; writes: string; decide: string; outline: { label: string; title: string; sections: readonly { id: string; title: string; covers: string }[] } }> = {
  "pv-discovery": {
    arg: "write a discovery for faster onboarding",
    works: "An idea or an existing initiative (add its code, for example R-12). Without a code it creates the one initiative that holds the discovery.",
    asks: ["Quick or full? Quick runs the building blocks it always needs; full also offers the rest.", "What is missing, asked once: the objective, the problem, the evidence and who is on the team. Every question can be skipped."],
    writes: "A Discovery document and the one initiative that holds it, in the Discover phase. The text of the document never reaches GitHub or Jira.",
    decide: "A person with approval rights approves the discovery at Gate A. The skill never decides, ranks or approves.",
    outline: { label: "Discovery", title: "Discovery: Example initiative", sections: DISCOVERY_SECTIONS },
  },
  "pv-prd": {
    arg: "write a PRD for faster onboarding",
    works: "A brief in your own words, or an existing initiative (add its code, for example R-12) to update instead of creating a new one.",
    asks: ["Quick or full? Quick runs success metrics and the split into steps; full also offers stories, a pre-mortem, a PR/FAQ and a business case.", "What is missing, asked once, grouped by module and skippable. Optional modules (A1 to D7) are included only when they fit."],
    writes: "A PRD in your usual nine-section format, kept as a document that never reaches GitHub or Jira as text, and the initiative with every field the brief supports. An AI draft until a person accepts it.",
    decide: "A person with approval rights approves the PRD at Gate B. The skill never sets Stack Rank, Value, Confidence or Decision.",
    outline: { label: "PRD", title: "PRD: Example initiative", sections: PRD_CORE },
  },
  "pv-company": {
    arg: "",
    works: "The whole company. It reads the public website set for the workspace (or the address you give).",
    asks: ["Which website, if none is set, and what to look at most closely.", "Which company-level skills to run as steps: personas, competitors, market, vision, strategy, north star and canvas."],
    writes: "A company profile as an AI draft, with a source and date for every statement. After you agree, it is saved for a workspace admin to confirm. Every later skill reads the confirmed profile.",
    decide: "A workspace admin confirms the profile. Until then it is a draft, and a competitor claim or market figure without a source is left out.",
    outline: { label: "Company profile", title: "Company profile", sections: PROFILE_SECTIONS.map((p, i) => ({ id: String(i + 1), title: p.title, covers: p.covers })) },
  },
};

function GuidedSkillPage({ command }: { command: string }) {
  const g = GUIDED[command]!;
  const b = skillBrief(command);
  return (
    <HelpPage current="skills" title={`${command}: ${b.title}`} intro={`${cap1(b.summary)}.`} toc={[{ id: "start", label: "Start it" }, { id: "asks", label: "What it asks" }, { id: "writes", label: "What it writes" }, { id: "inside", label: "What runs inside it" }, { id: "decide", label: "What you decide" }]}>
      <KindLine command={command} />
      <HelpSection id="start" title="Start it">
        <SkillStartFigure command={command} arg={g.arg} />
        <p><strong>Works on:</strong> {g.works}</p>
      </HelpSection>
      <HelpSection id="asks" title="What it asks">
        <p>It reads your company profile and what Product Velocity already holds, shows its plan, then asks. Every question can be skipped; what it cannot find stays &ldquo;to define&rdquo;.</p>
        <HelpList items={g.asks} />
      </HelpSection>
      <HelpSection id="writes" title="What it writes">
        <p>{g.writes}</p>
        <DocOutlineFigure label={g.outline.label} title={g.outline.title} tag="AI draft" sections={g.outline.sections} />
        {command === "pv-prd" && <p>Optional modules, included only when they fit: {PRD_MODULES.map((m) => m.title).slice(0, 6).join(", ")} and more.</p>}
      </HelpSection>
      <RunsInside command={command} />
      <HelpSection id="decide" title="What you decide">
        <HelpCallout title="Skills prepare; people decide.">{g.decide}</HelpCallout>
      </HelpSection>
      <Pager command={command} />
    </HelpPage>
  );
}

function HelpSkillPage() {
  return (
    <HelpPage current="skills" title="pv-help: List the skills" intro="Lists every skill, by kind, and how to use them." toc={[{ id: "start", label: "Start it" }, { id: "kinds", label: "The kinds" }]}>
      <KindLine command="pv-help" />
      <HelpSection id="start" title="Start it">
        <SkillStartFigure command="pv-help" />
        <p>It answers in the chat and saves nothing. For a recommendation about a situation, ask <Link2 c="pv-which" /> instead.</p>
      </HelpSection>
      <HelpSection id="kinds" title="The kinds">
        <SkillKindMap />
      </HelpSection>
      <Pager command="pv-help" />
    </HelpPage>
  );
}

/** One page per command: catalogue skills from their entry, the three guided flows from their templates, and pv-help (issue #644, #652). */
export function SkillHelpPage({ command }: { command: string }) {
  if (command === "pv-help") return <HelpSkillPage />;
  if (GUIDED[command]) return <GuidedSkillPage command={command} />;
  const skill = SKILLS.find((s) => s.command === command);
  if (!skill) return null;
  return <CatalogueSkillPage skill={skill} />;
}

function CatalogueSkillPage({ skill }: { skill: SkillSpec }) {
  const fields = skillFieldNames(skill);
  const d = skill.depth;
  const cap = cap1(skill.summary);
  const guided = (SKILL_PLANS[skill.command]?.includes ? [{ id: "inside", label: "What runs inside it" }] : []);
  return (
    <HelpPage current="skills" title={`${skill.command}: ${skill.title}`} intro={`${cap}.`} toc={[{ id: "start", label: "Start it" }, { id: "asks", label: "What it asks" }, { id: "writes", label: "What it writes" }, ...guided, { id: "decide", label: "What you decide" }, ...(d ? [{ id: "care", label: "When not to use it" }] : [])]}>
      <KindLine command={skill.command} />
      <HelpSection id="start" title="Start it">
        <SkillStartFigure command={skill.command} arg={skill.target === "item" ? "R-12" : skill.target === "items" ? "R-1 to R-5" : ""} />
        <p><strong>Works on:</strong> {worksOn(skill)}.</p>
        <p><strong>You get:</strong> {youGet(skill)}</p>
      </HelpSection>
      <HelpSection id="asks" title="What it asks">
        <p>It reads your company profile and what Product Velocity already holds, then asks once. Every question can be skipped; what it cannot find stays &ldquo;to define&rdquo;.</p>
        <ol className="hp-steps">
          {skill.questions.map((q) => (
            <li key={q.id}>{q.ask}{q.options && <ul>{q.options.map((o) => <li key={o.label}><strong>{o.label}</strong>: {o.useWhen}</li>)}</ul>}</li>
          ))}
        </ol>
      </HelpSection>
      <HelpSection id="writes" title="What it writes">
        <SkillDocFigure skill={skill} />
        {fields.length > 0 && <p>After you have seen a preview and agreed, it can fill these empty fields from the document: {fields.join(", ")}. A field that already has a value comes back as a before-and-after for you to confirm.</p>}
      </HelpSection>
      <RunsInside command={skill.command} />
      <HelpSection id="decide" title="What you decide">
        <HelpCallout title="Skills prepare; people decide.">Decided by {skill.decidedBy}. The skill never sets Stack Rank, Value, Confidence or Decision, and never approves a gate.</HelpCallout>
      </HelpSection>
      {d && (
        <HelpSection id="care" title="When not to use it, and common mistakes">
          {d.whenNot.length > 0 && (<><h3>When another skill fits better</h3><HelpList items={[...d.whenNot]} /></>)}
          {d.pitfalls.length > 0 && (
            <><h3>Common mistakes</h3>
              <ul className="hp-list">{d.pitfalls.map((p) => <li key={p.name}><strong>{p.name}.</strong> {p.why} {p.fix}</li>)}</ul></>
          )}
          <h3>What good looks like</h3>
          <p><strong>Stronger:</strong> {d.example.good}</p>
          <p><strong>Weaker:</strong> {d.example.weak}</p>
          <p>{d.example.why}</p>
        </HelpSection>
      )}
      <Pager command={skill.command} />
    </HelpPage>
  );
}
