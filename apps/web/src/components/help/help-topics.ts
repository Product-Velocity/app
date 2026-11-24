/** The Help site map: six topics that frame the product, then the reference pages. One list feeds the landing page, the side menu and the tests. */
export type HelpTopic = { slug: string; number?: string; title: string; summary: string; pills: string[] };

export const HELP_TOPICS: HelpTopic[] = [
  { slug: "okrs", number: "01", title: "Goals and impact", summary: "Connect company goals, objectives and key results to every initiative on the roadmap, then measure what each one achieved.", pills: ["Objective", "Key result", "Outcome review"] },
  { slug: "lifecycle", number: "02", title: "Lifecycle and decision gates", summary: "Seven phases, three gates. People decide at each gate and the reason is kept.", pills: ["Seven phases", "Gates A, B, C"] },
  { slug: "alignment", number: "03", title: "Alignment", summary: "Agree on priorities with a small team in a side panel, or with hundreds of people in an anonymous vote.", pills: ["Small groups", "Large groups", "Anonymous"] },
  { slug: "reports", number: "04", title: "Reporting", summary: "The right view for leadership, product, delivery and go-to-market, so each can act and decide.", pills: ["Leadership", "Roadmap Health", "Weekly update"] },
  { slug: "delivery", number: "05", title: "Delivery platforms", summary: "Connect GitHub and Jira, and see what is happening and when from one place.", pills: ["GitHub", "Jira", "One view"] },
  { slug: "ai", number: "06", title: "AI co-workers", summary: "Brainstorm, write and connect Discovery and PRD documents, and use them across the initiative journey.", pills: ["Brainstorm", "Discovery", "PRD"] },
];

export const HELP_REFERENCE: { slug: string; title: string; summary: string }[] = [
  { slug: "get-started", title: "Get started", summary: "The route from your first sign-in to a first decided initiative, a first-run checklist and a note for leaders." },
  { slug: "columns", title: "Fields and how they sync", summary: "Every column: what it is, how it syncs with GitHub and Jira, who can edit it and how it is updated." },
  { slug: "goal-fields", title: "Goal and outcome fields", summary: "The columns that record the expected impact, the key result and the outcome review." },
  { slug: "phases", title: "Phase by phase", summary: "For each phase: the question, the work, the evidence you keep, and how Product Velocity and AI co-workers help." },
  { slug: "statuses", title: "Phases and statuses: the lists", summary: "Every value of phase, status, health and planning status, what each means, and how to set them in common cases." },
  { slug: "sync-rules", title: "Sync steps and status rules", summary: "Connecting a tracker step by step, what flows each way, and which status changes where." },
  { slug: "attention", title: "Needs attention: the reasons", summary: "Every reason an initiative appears on Needs attention, when it shows and the next step." },
  { slug: "report-definitions", title: "Reports and how numbers are counted", summary: "What each report answers and what is on it, with the definitions behind Roadmap Health." },
  { slug: "skills", title: "AI skills", summary: "One page for every skill: how to start it, what it asks, what it writes and what you decide." },
  { slug: "ai-use-cases", title: "AI use-cases and documents", summary: "What to use an AI co-worker for, and where documents are used along the lifecycle." },
  { slug: "ai-setup", title: "Connect an AI assistant", summary: "Step by step setup for Claude, ChatGPT and Gemini." },
  { slug: "shortcuts", title: "Keyboard shortcuts", summary: "Move, edit and add initiatives without the mouse." },
];

export const helpPath = (slug?: string) => (slug ? `/help/${slug}` : "/help");
