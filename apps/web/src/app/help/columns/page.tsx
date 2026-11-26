import { ColumnsTable } from "@/components/help/columns-table";
import { HelpPage } from "@/components/help/help-ui";

export const metadata = {
  title: "Column reference · Help · Product Velocity",
  description: "Every column of the roadmap: what it is, how it relates to GitHub and Jira, who can edit it and how it is updated.",
};

export default function ColumnsHelp() {
  return (
    <HelpPage current="columns" title="Column reference" intro="Every column in the roadmap grid, in the order of the field dictionary. Use the filter to find one by name, tracker or access.">
      <p className="hint" id="people-fields">
        Product Manager, Engineering Manager, Designer, Analyst and Business Manager name a person. Pick a member, or type a name (and an email address if you have one) to add someone who is not a
        member yet: they are listed in Members as “Not invited”, count in reports by name, and nothing is sent to them until an admin invites them. When they join with that email, everything that names them stays. <a href="/help/people-and-access">People, roles and access</a> explains the difference between members, people not invited yet and participants.
      </p>
      <ColumnsTable />
    </HelpPage>
  );
}
