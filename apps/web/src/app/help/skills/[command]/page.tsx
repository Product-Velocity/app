import { notFound } from "next/navigation";
import { SKILLS } from "@pv/domain";
import { SkillHelpPage } from "@/components/help/skill-page";
import { skillByCommandSlug } from "@/components/help/skill-figures";

export const dynamicParams = false;
export const generateStaticParams = () => SKILLS.map((s) => ({ command: s.command }));

export async function generateMetadata({ params }: { params: Promise<{ command: string }> }) {
  const s = skillByCommandSlug((await params).command);
  return { title: `${s?.command ?? "Skill"} · AI skills · Help · Product Velocity`, description: s?.summary ? `${s.summary.charAt(0).toUpperCase()}${s.summary.slice(1)}.` : undefined };
}

export default async function SkillHelp({ params }: { params: Promise<{ command: string }> }) {
  const skill = skillByCommandSlug((await params).command);
  if (!skill) notFound();
  return <SkillHelpPage skill={skill} />;
}
