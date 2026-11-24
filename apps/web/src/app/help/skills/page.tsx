import { SKILLS, SKILL_STAGE_LABEL } from "@pv/domain";
import { HelpCallout, HelpCards, HelpPage, HelpReference, HelpSection } from "@/components/help/help-ui";
import { SkillStageMap, skillPath } from "@/components/help/skill-figures";

export const metadata = {
  title: "AI skills · Help · Product Velocity",
  description: "Every guided skill: what it asks, what it writes and what you decide.",
};

export default function SkillsHelp() {
  return (
    <HelpPage current="skills" title="AI skills" intro="Guided skills for the product job. Start one with pv- and its name in Claude, ChatGPT or Gemini. Each reads your company profile and what Product Velocity holds, asks once, and writes a draft you edit and a person accepts." toc={[{ id: "map", label: "Skills by stage" }, { id: "all", label: "Every skill" }]}>
      <HelpSection id="map" title="Skills by stage">
        <SkillStageMap />
        <HelpCallout title="AI prepares, people decide.">Skills never set Stack Rank, Value, Confidence or Decision, and never approve a gate. Every document names who decides.</HelpCallout>
      </HelpSection>
      <HelpSection id="all" title="Every skill">
        <HelpCards columns={3} items={SKILLS.map((s) => ({ title: s.command, text: s.summary.charAt(0).toUpperCase() + s.summary.slice(1), pills: [SKILL_STAGE_LABEL[s.stage]], href: skillPath(s.command) }))} />
        <HelpReference slug="ai-setup">Connect an AI assistant first</HelpReference>
        <HelpReference slug="ai-use-cases">What an agent does at each step, and tips for getting the most out of skills</HelpReference>
      </HelpSection>
    </HelpPage>
  );
}
