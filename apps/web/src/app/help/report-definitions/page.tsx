import { REPORTS_INTRO, REPORTS_LIST, ROADMAP_HEALTH_DEFINITIONS, ROADMAP_HEALTH_NOTES, VELOCITY_DEFINITIONS, VELOCITY_NOTES } from "@/components/help-content";
import { HelpList, HelpPage, HelpSection, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "Reports and how numbers are counted · Help · Product Velocity",
  description: "What each report on the Reports tab answers and contains, and the definitions behind Roadmap Health and Velocity.",
};

export default function ReportDefinitionsHelp() {
  return (
    <HelpPage current="report-definitions" title="Reports and how numbers are counted" intro={REPORTS_INTRO}>
      <HelpSection id="reports" title="The reports">
        <HelpTable caption="The reports" table={REPORTS_LIST} />
      </HelpSection>
      <HelpSection id="health" title="Roadmap Health: how the numbers are counted">
        <HelpTable caption="Roadmap Health: terms" table={ROADMAP_HEALTH_DEFINITIONS} />
        <HelpList items={ROADMAP_HEALTH_NOTES} />
      </HelpSection>
      <HelpSection id="velocity" title="Velocity: how the numbers are counted">
        <HelpTable caption="Velocity: terms" table={VELOCITY_DEFINITIONS} />
        <HelpList items={VELOCITY_NOTES} />
      </HelpSection>
    </HelpPage>
  );
}
