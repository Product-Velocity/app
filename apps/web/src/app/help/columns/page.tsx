import { ColumnsTable } from "@/components/help/columns-table";
import { HelpPage } from "@/components/help/help-ui";

export const metadata = {
  title: "Column reference · Help · Product Velocity",
  description: "Every column of the roadmap: what it is, how it relates to GitHub and Jira, who can edit it and how it is updated.",
};

export default function ColumnsHelp() {
  return (
    <HelpPage current="columns" title="Column reference" intro="Every column in the roadmap grid, in the order of the field dictionary. Use the filter to find one by name, tracker or access.">
      <ColumnsTable />
    </HelpPage>
  );
}
