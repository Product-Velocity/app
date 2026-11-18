import { notFound } from "next/navigation";
import { ProjectsCard } from "@/app/(workspace)/settings/workspace/projects-card";

// A harness page for Playwright (rename and delete a project, issue #526): fixed fake data, no sign-in. Only when NEXT_PUBLIC_E2E_HARNESS=1.
export default function ProjectsHarness() {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  return (
    <div className="page-narrow">
      <ProjectsCard canEdit projects={[
        { id: "11111111-1111-4111-8111-111111111111", name: "JIRA test", tracker: "jira", live: 4, trashed: 2 },
        { id: "22222222-2222-4222-8222-222222222222", name: "R89 Roadmap", tracker: null, live: 0, trashed: 0 },
        { id: "33333333-3333-4333-8333-333333333333", name: "Platform", tracker: "github", live: 1, trashed: 0 },
      ]} />
    </div>
  );
}
