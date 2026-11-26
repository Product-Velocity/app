import { ACCESS_CASES, PEOPLE_KINDS, PEOPLE_STATES, ROLE_TABLE, VOTE_VISIBILITY } from "@/components/help-content";
import { HelpCallout, HelpList, HelpPage, HelpReference, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "People, roles and access · Help · Product Velocity",
  description: "Participants, people not invited yet and members: what each can see and do, the roles and the Approver permission, and common cases.",
};

export default function PeopleAndAccessHelp() {
  return (
    <HelpPage
      current="people-and-access"
      title="People, roles and access"
      intro="Three kinds of people appear in Product Velocity: participants who vote, people your team has named but not invited, and members who have an account. This page says what each one can see and do, what the roles allow, and how to handle the common cases."
      toc={[
        { id: "kinds", label: "Three kinds of people" },
        { id: "roles", label: "Roles and approval" },
        { id: "states", label: "How a person moves" },
        { id: "votes", label: "What a vote shows" },
        { id: "cases", label: "Use-cases" },
        { id: "claude", label: "Claude and other assistants" },
      ]}
    >
      <HelpSection id="kinds" title="Three kinds of people">
        <p>Only members have an account and can open the workspace. The other two are never given access by being named or by voting.</p>
        <HelpTable caption="Participants, people not invited yet, and members" table={PEOPLE_KINDS} />
        <HelpCallout title="Naming someone is not inviting them">
          A name on an initiative is only a name. It counts in reports and filters from the first day, and nothing is sent to the person until an admin invites them. When they join with the same email, every initiative that names them keeps naming them.
        </HelpCallout>
        <HelpWhere>Members, under “Not invited yet” (admins). A Creator or an admin can add a person from any person field: type a name, and an email if you have one, and choose Add.</HelpWhere>
      </HelpSection>

      <HelpSection id="roles" title="Roles and approval">
        <p>A member has one role in each workspace. Approval is a separate permission, so a Creator can be an Approver without being an Admin.</p>
        <HelpTable caption="What each role can and cannot do" table={ROLE_TABLE} />
        <HelpList
          items={[
            "Roles are set by an admin in Members and change at once; there is nothing to sign out of.",
            "Anyone can be paused or revoked without losing what they created.",
            "Platform staff are not members. They can only enter a workspace deliberately; it is logged and visible to the admins, and they can never approve, send or read secrets.",
          ]}
        />
        <HelpReference slug="lifecycle">Lifecycle and decision gates: who decides each gate</HelpReference>
      </HelpSection>

      <HelpSection id="states" title="How a person moves">
        <HelpTable caption="The states of a person, and what moves them on" table={PEOPLE_STATES} />
        <p>Inviting never changes anyone&rsquo;s role by accident: an invitation to someone who is already a member is refused, and an invitation always wins over joining by company domain.</p>
      </HelpSection>

      <HelpSection id="votes" title="What a vote shows each kind of person">
        <p>An alignment vote asks people for their view without making them members. Votes are anonymous to everyone except through one logged action, and participants stay separate from the people list: nothing links a participant to a person or a member.</p>
        <HelpTable caption="Who sees what in an alignment vote" table={VOTE_VISIBILITY} />
        <p>When an admin builds an invitation list from the people list, the name and email are copied into the vote and no link is kept.</p>
        <HelpReference slug="alignment">Alignment: small groups and large groups</HelpReference>
      </HelpSection>

      <HelpSection id="cases" title="Use-cases">
        <HelpTable caption="Common cases, and what to do" table={ACCESS_CASES} />
      </HelpSection>

      <HelpSection id="claude" title="Claude and other assistants">
        <HelpList
          items={[
            "An assistant works as the signed-in person, with that person's role. A Viewer's assistant can read; a Creator's can also change initiatives.",
            "It can set a person field to someone on the list, including someone not invited yet. It cannot add a person or send an invitation.",
            "It never decides a gate or moves a phase. It can prepare the gate pack for the person who decides.",
            "Everything it writes is audited with who, when, which assistant and which model.",
          ]}
        />
        <HelpReference slug="ai-setup">Connect an AI assistant</HelpReference>
      </HelpSection>
    </HelpPage>
  );
}
