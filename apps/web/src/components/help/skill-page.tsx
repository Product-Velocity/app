import Link from "next/link";
import { SKILLS, SKILL_STAGE_LABEL, docKindLabel, type SkillSpec } from "@pv/domain";
import { HelpCallout, HelpList, HelpPage, HelpSection } from "./help-ui";
import { SkillDocFigure, SkillStartFigure, skillFieldNames, skillPath } from "./skill-figures";

const worksOn = (s: SkillSpec) =>
  s.output === "advice" ? "Your situation, in your own words" : s.focus ? "The whole workspace, or only the initiatives you name (codes, a range such as R-1 to R-5, a view or a group)" : s.target === "none" ? "The whole workspace; no initiative needed" : s.target === "items" ? "Several initiatives" : "One initiative (a code such as R-12)";

const youGet = (s: SkillSpec) =>
  s.output === "advice" ? "Advice in the chat. Nothing is saved."
  : s.output === "report" ? "A report in the format you choose (email, slides, document, Slack message or the chat). Nothing is saved or sent unless you ask for a copy."
  : s.target === "none" ? `A ${docKindLabel(s.doc.kind)} document in Documents, marked as an AI draft until a person accepts it.`
  : `A ${docKindLabel(s.doc.kind)} document on the initiative's Spec tab, marked as an AI draft until a person accepts it.`;

/** One page per skill, built only from the catalogue entry (issue #644). */
export function SkillHelpPage({ skill }: { skill: SkillSpec }) {
  const i = SKILLS.findIndex((s) => s.command === skill.command);
  const prev = SKILLS[i - 1];
  const next = SKILLS[i + 1];
  const fields = skillFieldNames(skill);
  const d = skill.depth;
  const cap = skill.summary.charAt(0).toUpperCase() + skill.summary.slice(1);
  return (
    <HelpPage current="skills" title={`${skill.command}: ${skill.title}`} intro={`${cap}.`} toc={[{ id: "start", label: "Start it" }, { id: "asks", label: "What it asks" }, { id: "writes", label: "What it writes" }, { id: "decide", label: "What you decide" }, ...(d ? [{ id: "care", label: "When not to use it" }] : [])]}>
      <p className="hp-where"><span>Stage</span> {SKILL_STAGE_LABEL[skill.stage]} · <Link href="/help/skills">All skills</Link></p>
      <HelpSection id="start" title="Start it">
        <SkillStartFigure skill={skill} />
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
      <nav className="hp-pager" aria-label="Other skills">
        {prev ? <Link href={skillPath(prev.command)}>&larr; {prev.command}</Link> : <span />}
        {next ? <Link href={skillPath(next.command)}>{next.command} &rarr;</Link> : <span />}
      </nav>
    </HelpPage>
  );
}
