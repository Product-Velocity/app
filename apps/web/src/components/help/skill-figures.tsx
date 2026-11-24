import Link from "next/link";
import { FIELD_BY_KEY, SKILLS, SKILL_STAGE_LABEL, docKindLabel, type SkillSpec, type SkillStage } from "@pv/domain";

/**
 * Figures for the skill reference (issue #644). Every figure is read from the skills catalogue (packages/domain/src/skills-catalog.ts),
 * so a renamed or new skill changes the picture with no edit here. They are drawn in markup, not as images: they follow the theme,
 * scale, and carry a text alternative. Content in them is labelled as an example.
 */

export const skillSlug = (command: string) => command;
export const skillPath = (command: string) => `/help/skills/${skillSlug(command)}`;
export const skillByCommandSlug = (slug: string): SkillSpec | undefined => SKILLS.find((s) => s.command === slug);

/** The first sentence of a section's description, short enough for a line in a figure. */
export function firstSentence(text: string, max = 120): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

const STAGE_ORDER: SkillStage[] = ["direction", "discover", "define", "decide", "prove", "deliver", "launch", "run"];

/** The product life as eight stages, each listing its skills as links. */
export function SkillStageMap() {
  const stages = STAGE_ORDER.filter((st) => SKILLS.some((s) => s.stage === st));
  const text = stages.map((st) => `${SKILL_STAGE_LABEL[st]}: ${SKILLS.filter((s) => s.stage === st).map((s) => s.command).join(", ")}`).join(". ");
  return (
    <figure className="hp-stagemap" aria-label={`Skills by stage. ${text}`}>
      <ol>
        {stages.map((st, i) => (
          <li key={st}>
            <span className="hp-stage-n">{String(i + 1).padStart(2, "0")}</span>
            <b>{SKILL_STAGE_LABEL[st]}</b>
            <ul>
              {SKILLS.filter((s) => s.stage === st).map((s) => (
                <li key={s.command}><Link href={skillPath(s.command)}>{s.command}</Link></li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <figcaption>The stages are a guide, not a gate: use any skill at any time. Not sure? Ask <code>pv-which</code> and describe your situation.</figcaption>
    </figure>
  );
}

/** What you type, as a chat line. */
export function SkillStartFigure({ skill }: { skill: SkillSpec }) {
  const arg = skill.target === "item" ? " R-12" : skill.target === "items" ? " R-1 to R-5" : "";
  return (
    <figure className="hp-chat" aria-label={`You type ${skill.command}${arg}`}>
      <span className="hp-chat-who">You</span>
      <code>{skill.command}{arg}</code>
      <figcaption>Example. Add your own words after it, or <code>--draft</code> to read the result in the chat before anything is saved.</figcaption>
    </figure>
  );
}

/** The structure of the document the skill writes, one numbered row per section. */
export function SkillDocFigure({ skill }: { skill: SkillSpec }) {
  const label = skill.output === "report" ? "Report" : skill.output === "advice" ? "Advice" : docKindLabel(skill.doc.kind);
  const title = skill.output === "document" || skill.output === undefined ? `${skill.doc.titlePrefix}${skill.target === "none" ? "your workspace" : "Example initiative"}` : skill.title;
  const alt = `${label} outline: ${skill.sections.map((s) => s.title).join(", ")}`;
  return (
    <figure className="hp-docfig" aria-label={alt}>
      <div className="hp-docfig-bar">
        <b>{title}</b>
        {skill.output === "report" || skill.output === "advice" ? <span className="hp-docfig-tag">Not saved</span> : <span className="hp-docfig-tag">AI draft</span>}
      </div>
      <ol>
        {skill.sections.map((s) => (
          <li key={s.id}>
            <span className="hp-docfig-n">{s.id}</span>
            <span><b>{s.title}</b><br />{firstSentence(s.covers)}</span>
          </li>
        ))}
      </ol>
      <figcaption>Example outline. The text is yours to edit; a section with nothing for it is left out.</figcaption>
    </figure>
  );
}

/** The fields a skill may fill, by their names in the app. */
export const skillFieldNames = (skill: SkillSpec) => skill.fields.map((k) => FIELD_BY_KEY[k]?.name ?? k);
