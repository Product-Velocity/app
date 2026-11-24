import Link from "next/link";
import { FIELD_BY_KEY, GUIDED_ONLY, SKILLS, SKILL_PLANS, SKILL_STAGE_LABEL, SKILL_TIERS, SKILL_TIER_LABEL, docKindLabel, type SkillSpec, type SkillStage } from "@pv/domain";

/**
 * Figures for the skill reference (issue #644). Every figure is read from the skills catalogue (packages/domain/src/skills-catalog.ts),
 * so a renamed or new skill changes the picture with no edit here. They are drawn in markup, not as images: they follow the theme,
 * scale, and carry a text alternative. Content in them is labelled as an example.
 */

export const skillSlug = (command: string) => command;
export const skillPath = (command: string) => `/help/skills/${skillSlug(command)}`;
export const skillByCommandSlug = (slug: string): SkillSpec | undefined => SKILLS.find((s) => s.command === slug);

/** Every command that has a Help page: the three guided flows that are not catalogue entries, the catalogue, and pv-help. Order is the pager order. */
export const HELP_SKILL_COMMANDS: readonly string[] = [...GUIDED_ONLY.map((g) => g.command), ...SKILLS.map((s) => s.command), "pv-help"];
export const isHelpSkill = (slug: string) => HELP_SKILL_COMMANDS.includes(slug);
/** Title, summary and stage of any command with a page (pv-help has no stage). */
export function skillBrief(command: string): { command: string; title: string; summary: string; stage?: SkillStage } {
  const g = GUIDED_ONLY.find((x) => x.command === command);
  if (g) return g;
  const s = SKILLS.find((x) => x.command === command);
  if (s) return s;
  return { command, title: "List the skills", summary: "list the skills, by kind, and how to use them" };
}
export const skillKind = (command: string) => SKILL_PLANS[command]?.tier;

/** The first sentence of a section's description, short enough for a line in a figure. */
export function firstSentence(text: string, max = 120): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

const STAGE_ORDER: SkillStage[] = ["direction", "discover", "define", "decide", "prove", "deliver", "launch", "run"];

/** The product life as eight stages, each listing its skills as links. */
export function SkillStageMap() {
  const inStage = (st: SkillStage) => [...GUIDED_ONLY.filter((g) => g.stage === st), ...SKILLS.filter((x) => x.stage === st)].map((x) => x.command);
  const stages = STAGE_ORDER.filter((st) => inStage(st).length > 0);
  const text = stages.map((st) => `${SKILL_STAGE_LABEL[st]}: ${inStage(st).join(", ")}`).join(". ");
  return (
    <figure className="hp-stagemap" aria-label={`Skills by stage. ${text}`}>
      <ol>
        {stages.map((st, i) => (
          <li key={st}>
            <span className="hp-stage-n">{String(i + 1).padStart(2, "0")}</span>
            <b>{SKILL_STAGE_LABEL[st]}</b>
            <ul>
              {inStage(st).map((c) => (
                <li key={c}><Link href={skillPath(c)}>{c}</Link></li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <figcaption>The stages are a guide, not a gate: use any skill at any time. Not sure? Ask <code>pv-which</code> and describe your situation, or type <code>pv-help</code> to list the skills.</figcaption>
    </figure>
  );
}

/** What you type, as a chat line. `arg` is the example argument (an initiative code, or nothing). */
export function SkillStartFigure({ command, arg = "" }: { command: string; arg?: string }) {
  const line = `${command}${arg ? ` ${arg}` : ""}`;
  return (
    <figure className="hp-chat" aria-label={`You type ${line}`}>
      <span className="hp-chat-who">You</span>
      <code>{line}</code>
      <figcaption>Example. Add your own words after it, or <code>--draft</code> to read the result in the chat before anything is saved.</figcaption>
    </figure>
  );
}

/** The skills by kind: where to start, the building blocks, company knowledge, advanced, and the router. */
export function SkillKindMap() {
  return (
    <figure className="hp-kindmap" aria-label={`Skills by kind. ${SKILL_TIERS.map((t) => `${SKILL_TIER_LABEL[t]}: ${kindCommands(t).join(", ")}`).join(". ")}`}>
      <ol>
        {SKILL_TIERS.map((t) => (
          <li key={t}>
            <b>{SKILL_TIER_LABEL[t]}</b>
            <ul>{kindCommands(t).map((c) => <li key={c}><Link href={skillPath(c)}>{c}</Link></li>)}</ul>
          </li>
        ))}
      </ol>
      <figcaption>A guided skill shows its plan, asks whether you want quick or full, and runs the building blocks it needs as steps of one document.</figcaption>
    </figure>
  );
}
const kindCommands = (t: string) => Object.keys(SKILL_PLANS).filter((c) => SKILL_PLANS[c]?.tier === t && isHelpSkill(c));

/** The structure of a document, one numbered row per section. */
export function DocOutlineFigure({ label, title, tag, sections }: { label: string; title: string; tag: string; sections: readonly { id: string; title: string; covers: string }[] }) {
  return (
    <figure className="hp-docfig" aria-label={`${label} outline: ${sections.map((s) => s.title).join(", ")}`}>
      <div className="hp-docfig-bar"><b>{title}</b><span className="hp-docfig-tag">{tag}</span></div>
      <ol>
        {sections.map((s) => (
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

/** The outline of the document a catalogue skill writes. */
export function SkillDocFigure({ skill }: { skill: SkillSpec }) {
  const label = skill.output === "report" ? "Report" : skill.output === "advice" ? "Advice" : docKindLabel(skill.doc.kind);
  const title = skill.output === "document" || skill.output === undefined ? `${skill.doc.titlePrefix}${skill.target === "none" ? "your workspace" : "Example initiative"}` : skill.title;
  return <DocOutlineFigure label={label} title={title} tag={skill.output === "report" || skill.output === "advice" ? "Not saved" : "AI draft"} sections={skill.sections} />;
}

/** The fields a skill may fill, by their names in the app. */
export const skillFieldNames = (skill: SkillSpec) => skill.fields.map((k) => FIELD_BY_KEY[k]?.name ?? k);
