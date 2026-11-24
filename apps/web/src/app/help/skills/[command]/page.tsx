import { notFound } from "next/navigation";
import { SkillHelpPage } from "@/components/help/skill-page";
import { HELP_SKILL_COMMANDS, isHelpSkill, skillBrief } from "@/components/help/skill-figures";

export const dynamicParams = false;
export const generateStaticParams = () => HELP_SKILL_COMMANDS.map((command) => ({ command }));

export async function generateMetadata({ params }: { params: Promise<{ command: string }> }) {
  const c = (await params).command;
  const b = isHelpSkill(c) ? skillBrief(c) : undefined;
  return { title: `${b?.command ?? "Skill"} · AI skills · Help · Product Velocity`, description: b?.summary ? `${b.summary.charAt(0).toUpperCase()}${b.summary.slice(1)}.` : undefined };
}

export default async function SkillHelp({ params }: { params: Promise<{ command: string }> }) {
  const command = (await params).command;
  if (!isHelpSkill(command)) notFound();
  return <SkillHelpPage command={command} />;
}
