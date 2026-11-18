import { ATTENTION_INTRO, ATTENTION_TABLE } from "@/components/help-content";
import { HelpPage, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "Needs attention: the reasons · Help · Product Velocity",
  description: "Every reason an initiative appears on the Needs attention tab, when it shows and the next step.",
};

export default function AttentionHelp() {
  return (
    <HelpPage current="attention" title="Needs attention: the reasons" intro={ATTENTION_INTRO}>
      <HelpTable caption="What needs attention" table={ATTENTION_TABLE} />
    </HelpPage>
  );
}
