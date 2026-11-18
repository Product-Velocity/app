import { HelpCallout, HelpCards, HelpPage } from "@/components/help/help-ui";
import { HELP_REFERENCE, HELP_TOPICS, helpPath } from "@/components/help/help-topics";

export const metadata = {
  title: "Help · Product Velocity",
  description: "How Product Velocity connects goals, decisions, delivery and results on one roadmap, and how to use each part.",
};

export default function HelpHome() {
  return (
    <HelpPage
      title="Help"
      intro="Product Velocity keeps one roadmap and one ranking for the whole company, and follows each initiative from idea to measured impact. Start with the topic that matches your question."
    >
      <HelpCards
        columns={3}
        items={HELP_TOPICS.map((t) => ({ number: t.number, title: t.title, text: t.summary, pills: t.pills, href: helpPath(t.slug) }))}
      />
      <HelpCallout title="The test for every initiative: which key result does it move?">
        If the answer is none, the initiative needs a reason to be on the roadmap. The roadmap stays the plan; goals tell you why each item is on it and how you know it worked.
      </HelpCallout>
      <h2 className="hp-h2">Reference</h2>
      <HelpCards columns={3} items={HELP_REFERENCE.map((r) => ({ title: r.title, text: r.summary, href: helpPath(r.slug) }))} />
    </HelpPage>
  );
}
