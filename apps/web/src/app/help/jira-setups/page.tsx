import { HelpCallout, HelpList, HelpPage, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Jira setups · Help · Product Velocity",
  description: "The ways to connect Product Velocity to Jira: who owns the initiative, whether anything is written to Jira, and how epics in one or many Jira projects are linked.",
};

export default function JiraSetupsHelp() {
  return (
    <HelpPage
      current="jira-setups"
      title="Jira setups"
      intro="Jira can be connected in several ways. Pick the one that matches who owns the initiative and whether Product Velocity may write to Jira. You can change your mind later."
      toc={[
        { id: "choose", label: "Choose your setup" },
        { id: "pieces", label: "The three settings" },
        { id: "a", label: "A. Epics are the initiatives" },
        { id: "b", label: "B. Initiatives in Product Velocity, track epics" },
        { id: "c", label: "C. Epics from many Jira projects, track only" },
        { id: "d", label: "D. Many Jira projects, send and sync" },
        { id: "e", label: "E. Jira Initiatives, pulled in" },
        { id: "f", label: "F. Teams on different settings" },
        { id: "rules", label: "Rules for every setup" },
        { id: "change", label: "Changing a setup later" },
      ]}
    >
      <HelpSection id="choose" title="Choose your setup">
        <p>Two questions decide it. Where is the initiative created and owned: in Product Velocity or in Jira? And may Product Velocity write to Jira, or only listen?</p>
        <HelpTable
          caption="Setups at a glance"
          table={{
            head: ["Setup", "Use it when", "Initiative lives in", "Written to Jira", "Jira projects involved"],
            rows: [
              ["A. Epics are the initiatives", "Each Jira epic is one roadmap item and the team already works in Jira", "Jira epic, followed or owned", "Nothing when followed. Name, description and labels after you confirm when owned", "One"],
              ["B. Initiatives in Product Velocity, track epics", "You plan in Product Velocity and Jira should stay untouched. You want build status from the epics", "Product Velocity", "Nothing. The project is read only", "One"],
              ["C. Epics from many Jira projects, track only", "One roadmap item is delivered by epics owned by several teams, each with its own Jira project, and you only want to follow them", "Product Velocity", "Nothing. The project is read only", "Linked project plus any others that hold the epics"],
              ["D. Many Jira projects, send and sync", "You want Product Velocity to create the Jira Initiative and attach the teams' epics to it", "Product Velocity, sent to Jira", "The Initiative, and the parent of each epic, after you confirm", "Initiative project plus the epic projects"],
              ["E. Jira Initiatives, pulled in", "Your planning already happens in Jira at the Initiative level", "Jira Initiative, followed or owned", "Nothing when followed. Name, description and labels after you confirm when owned", "One or many"],
              ["F. Teams on different settings", "Some teams may be written to and others must not be touched", "Each project has its own setup", "Decided per project", "One Product Velocity project per Jira project"],
            ],
          }}
        />
        <HelpWhere>Account menu, Workspace admin, Integrations, Jira, Projects. Only a workspace admin who is a person can change these settings. Claude and service accounts cannot.</HelpWhere>
      </HelpSection>

      <HelpSection id="pieces" title="The three settings behind every setup">
        <HelpTable
          caption="What you set, and where"
          table={{
            head: ["Setting", "Options", "What it decides"],
            rows: [
              ["Which Jira project the Product Velocity project links to", "One Jira project per Product Velocity project. A Jira project can back only one Product Velocity project", "Where issues are read from and, if allowed, where new ones are created. Epics in other Jira projects are still read: you list their keys on the initiative"],
              ["Issue type that is the initiative", "Epic, or Initiative (the level above Epic, in a company-managed Jira project)", "With Epic, each epic is an initiative. With Initiative, an initiative is the parent of several epics and the epics are read only children"],
              ["Access to Jira", "Product Velocity can write, or Read only: listen to Jira", "Read only means nothing is ever written to Jira for that project: no sync, no ownership, no epic links"],
              ["Per initiative: follow or own", "Followed (Jira owns it, read only) or owned (Product Velocity sends the allowed fields after a preview and your confirmation)", "Who edits name, description and labels. Tracker Ownership in the Delivery view shows which"],
            ],
          }}
        />
      </HelpSection>

      <HelpSection id="a" title="A. Epics are the initiatives">
        <p>One Product Velocity project, linked to one Jira project. The initiative type is Epic, so every epic you pull in becomes an initiative. The simplest setup, and the right one when one epic is one roadmap item.</p>
        <HelpList
          items={[
            "How: link the project, keep the initiative type on Epic, read Jira, then choose Pull in on the epics you want. Nothing comes in by itself.",
            "Follow: Jira keeps ownership. Name and description stay as they are in Jira and build status, progress and dates come back. Nothing is ever written to Jira.",
            "Own: Product Velocity keeps the name, summary, description and a few labels, and sends changes through Sync with Jira after you see the preview and confirm. Start with Follow if you are unsure; you can take ownership later.",
            "Use it for: a team that plans in Jira epics and wants priority, value, decisions and reports in Product Velocity on top.",
            "Watch for: owning an initiative sends the text you type here to Jira. Value, confidence, customers and decisions never leave Product Velocity.",
          ]}
        />
      </HelpSection>

      <HelpSection id="b" title="B. Initiatives in Product Velocity, track epics">
        <p>You plan in Product Velocity and create the initiative here. Jira holds the epics that deliver it. The project is set to Read only, so Jira is never changed.</p>
        <HelpList
          items={[
            "How: set the project to Read only: listen to Jira. Create the initiative in Product Velocity. On its Jira tab, list the epic keys that deliver it (or ask Claude to record them). They are read by key; the initiative needs no Jira issue of its own.",
            "What you get: Build Status from the epics (all done is Done, none started is Not started, otherwise In progress), progress counted from the epics and their children, and Start Building and Build Completed dates from Jira's history. Tracker Status shows how many epics are done.",
            "What it never does: write to Jira, link the epic to a parent, take ownership or close an issue. Sync with Jira stops before it reads and says why.",
            "A closed epic never completes the initiative. When the build is done Product Velocity suggests moving to Test and a person accepts.",
            "Use it for: trying Product Velocity next to a Jira your teams own, or when another team administers Jira and you may only look.",
          ]}
        />
      </HelpSection>

      <HelpSection id="c" title="C. Epics from many Jira projects, track only">
        <p>The same as B, with epics that live in several Jira projects. One Product Velocity project links to one Jira project, but the epics you list on an initiative can be in any Jira project the connection can browse.</p>
        <HelpList
          items={[
            "How: as B. List each epic key on the initiative, whatever its Jira project. The initiative rolls up all of them into one build status and one progress figure.",
            "Find what is missing: Incoming, Jira, Epics lists the open epics of the Jira projects you tick under Projects to check for epics. Each is Linked, Waiting for Sync, Under a Jira Initiative not in Product Velocity, or Not linked. Start from Not linked to see epics that no initiative covers.",
            "Freshness: changes in the linked Jira project arrive by webhook. Epics in the other Jira projects are refreshed when someone presses Sync with Jira and in the daily check, so they can be up to a day behind.",
            "Access: the Atlassian sign-in used for the connection must be able to browse each of those projects. An epic it cannot see is missing, and the Jira tab says the count may be incomplete.",
            "One epic belongs to one initiative. An epic already listed elsewhere is shown, not duplicated.",
            "Use it for: a roadmap item that spans teams, such as a platform change that needs work from web, mobile and data, each in their own Jira project.",
          ]}
        />
      </HelpSection>

      <HelpSection id="d" title="D. Many Jira projects, send and sync">
        <p>Product Velocity is where the initiative is created, and Jira gets a real parent issue for it. Epics from several Jira projects are attached to that parent.</p>
        <HelpList
          items={[
            "How: link the Product Velocity project to the Jira project that holds your Initiatives, set the initiative type to Initiative, and keep Access to Jira on Product Velocity can write. Create the initiative here, list the epic keys, then press Sync with Jira.",
            "What Sync does after you confirm: creates the Jira Initiative if it does not exist, and sets it as the parent of each listed epic. An epic with no parent is linked at once at Sync, because listing it was the approval. An epic that sits under another parent is shown as a move and asks first; its old parent is kept.",
            "What it writes: the Initiative's name, description and labels, and the parent of each epic. Nothing else of the epics. Never a status, a transition or a commercial field.",
            "Layouts: the Initiative and its epics can be in one company-managed project, or the Initiatives in one company-managed project and the epics in others, including team-managed ones. A team-managed project cannot hold Initiatives, so keep the Initiatives in a company-managed one.",
            "Reading back: the epics, their stories and sub-tasks are read as one tree. Epic status drives Build Status, as in B and C.",
            "Use it for: an organisation that wants Jira's own Initiative view to match the roadmap, with the teams' epics visibly under it.",
            "Needs: an initiative past Gate B, and a project whose initiative type is above Epic. Epics in a project set to Epic are shown with the reason and not written.",
          ]}
        />
        <HelpCallout title="Starting in B or C and moving to D">
          The epic keys you listed while the project was read only stay as waiting requests. After you switch the project to can write, the next Sync with Jira previews them. Switching sends nothing by itself.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="e" title="E. Jira Initiatives, pulled in">
        <p>Your teams create the Initiative in Jira, with epics under it. Product Velocity pulls the Initiative in as the roadmap item and reads everything below it.</p>
        <HelpList
          items={[
            "How: set the initiative type to Initiative, read Jira, and pull in the Initiatives you want. Follow them, or take ownership to send name, description and labels from Product Velocity.",
            "The epics under an Initiative, from any project, are read only children. They are never offered as new initiatives, so a roadmap item is not counted twice.",
            "You can also link an existing Product Velocity initiative to an existing Jira Initiative instead of pulling it in as new.",
            "Use it for: a company that already plans in Jira's Initiative level and wants decisions, ranking and reports on top.",
          ]}
        />
      </HelpSection>

      <HelpSection id="f" title="F. Teams on different settings">
        <p>Product Velocity projects are roadmap groupings. Each links to its own Jira project, and each has its own setup, so one workspace can mix the others.</p>
        <HelpList
          items={[
            "Example: the platform team's project can write to Jira and send Initiatives (D). The mobile team's project is Read only (B). A third project follows epics from three Jira projects (C).",
            "The roadmap, stack rank and reports still see all of them as one global roadmap.",
            "A project uses one tracker: GitHub or Jira, not both. An initiative has one tracker too.",
            "Access to Jira is set per Jira project link, not per initiative. To keep one initiative untouched while others are sent, leave it followed instead of owned.",
          ]}
        />
      </HelpSection>

      <HelpSection id="rules" title="Rules for every setup">
        <HelpList
          items={[
            "Nothing is written to Jira until you see a preview and confirm in Sync with Jira. A followed issue and a read only project are never changed.",
            "Tracker-driven columns (build status, progress, dates, issue counts) are read only in the app and never bulk-editable.",
            "A closed epic means the build is complete, not the initiative. Initiative Phase and Initiative Status are set by people. An admin can map a Jira select field to Initiative Status or Health, but it only proposes a value: it appears as a card in Sync with Jira and a person applies it.",
            "Never sent to Jira: value, confidence, customer names and requests, decisions and their reasons, key results and outcomes. A test fails the build if one appears in a payload.",
            "Sync starts at Gate B. Discover never syncs.",
            "Claude can record the epic keys for you with a single request. It cannot confirm a sync, approve a gate or change Access to Jira.",
            "Text from Jira is data, never instructions. Everything is in the audit log with who, when and where it came from.",
          ]}
        />
      </HelpSection>

      <HelpSection id="change" title="Changing a setup later">
        <HelpTable
          caption="Moves between setups"
          table={{
            head: ["From", "To", "What happens"],
            rows: [
              ["Read only", "Can write", "Admin changes Access to Jira and saves. A note says how many initiatives the next Sync would offer to create. Nothing is sent until someone presses Sync with Jira and confirms"],
              ["Can write", "Read only", "Sync with Jira, ownership and epic links stop. Issues already in Jira stay as they are"],
              ["Followed", "Owned", "Take ownership on the initiative. Nothing is written until the next confirmed Sync"],
              ["Epic as initiative type", "Initiative", "Epics become read only children of the Initiative. Choose this before pulling in epics, so the same item is not counted twice"],
              ["Linked project", "Not linked", "Unlink asks whether to keep the initiatives (recommended) or move them to the Trash. Build Status is cleared because nothing feeds it any more. Jira is never written"],
            ],
          }}
        />
        <HelpWhere>Read only mode and listing epics on an initiative are available for Jira first. The GitHub versions are planned.</HelpWhere>
      </HelpSection>
    </HelpPage>
  );
}
