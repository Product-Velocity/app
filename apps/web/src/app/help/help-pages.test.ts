import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HELP_REFERENCE, HELP_TOPICS } from "@/components/help/help-topics";
import HelpHome from "./page";
import OkrsPage from "./okrs/page";
import LifecyclePage from "./lifecycle/page";
import AlignmentPage from "./alignment/page";
import ReportsHelp from "./reports/page";
import DeliveryHelp from "./delivery/page";
import AiHelp from "./ai/page";
import AiSetupHelp from "./ai-setup/page";
import ColumnsHelp from "./columns/page";
import ShortcutsHelp from "./shortcuts/page";
import GoalFieldsHelp from "./goal-fields/page";
import PhasesHelp from "./phases/page";
import StatusesHelp from "./statuses/page";
import SyncRulesHelp from "./sync-rules/page";
import AttentionHelp from "./attention/page";
import ReportDefinitionsHelp from "./report-definitions/page";
import AiUseCasesHelp from "./ai-use-cases/page";
import GetStartedHelp from "./get-started/page";
import SkillsHelp from "./skills/page";
import { SKILLS } from "@pv/domain";
import { SkillHelpPage } from "@/components/help/skill-page";

const PAGES: Record<string, () => React.JSX.Element> = {
  "": HelpHome, okrs: OkrsPage, lifecycle: LifecyclePage, alignment: AlignmentPage, reports: ReportsHelp, delivery: DeliveryHelp, ai: AiHelp,
  "ai-setup": AiSetupHelp, columns: ColumnsHelp, shortcuts: ShortcutsHelp, "goal-fields": GoalFieldsHelp, phases: PhasesHelp, statuses: StatusesHelp, "sync-rules": SyncRulesHelp, attention: AttentionHelp,
  "report-definitions": ReportDefinitionsHelp, "ai-use-cases": AiUseCasesHelp, skills: SkillsHelp, "get-started": GetStartedHelp,
};
const html: Record<string, string> = Object.fromEntries(Object.entries(PAGES).map(([k, P]) => [k, renderToStaticMarkup(createElement(P))]));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&rsquo;|&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Help pages", () => {
  it("has a page for every topic and reference entry, and the home page links to each", () => {
    for (const t of [...HELP_TOPICS, ...HELP_REFERENCE]) {
      expect(PAGES[t.slug], t.slug).toBeDefined();
      expect(html[""], t.slug).toContain(`href="/help/${t.slug}"`);
    }
  });
  it("frames the product in the six topics, in order", () => {
    expect(HELP_TOPICS.map((t) => t.slug)).toEqual(["okrs", "lifecycle", "alignment", "reports", "delivery", "ai"]);
  });
  it("gives every page one heading, the side menu and a way back to the app", () => {
    for (const [k, h] of Object.entries(html)) {
      expect(h.match(/<h1[ >]/g), k).toHaveLength(1);
      expect(h, k).toContain('aria-label="Help topics"');
      expect(h, k).toContain('href="/app"');
    }
  });
  it("marks the current page in the menu", () => {
    for (const t of [...HELP_TOPICS, ...HELP_REFERENCE]) expect(html[t.slug], t.slug).toMatch(new RegExp(`(href="/help/${t.slug}" aria-current="page"|aria-current="page" href="/help/${t.slug}")`));
  });
  it("keeps the long tables in the reference pages and points to them from the topics", () => {
    const tables = (k: string) => ((html[k] ?? "").match(/<table/g) ?? []).length;
    for (const k of ["okrs", "lifecycle", "reports", "delivery", "ai"]) expect(tables(k), k).toBeLessThanOrEqual(3);
    expect(html.lifecycle!).toContain('href="/help/phases"');
    expect(html.lifecycle!).toContain('href="/help/sync-rules"');
    expect(html.lifecycle!).toContain('href="/help/attention"');
    expect(html.okrs!).toContain('href="/help/goal-fields"');
    expect(html.reports!).toContain('href="/help/report-definitions"');
    expect(html.delivery!).toContain('href="/help/sync-rules"');
    expect(html.delivery!).toContain('href="/help/columns"');
    expect(html.ai!).toContain('href="/help/ai-use-cases"');
    expect(tables("columns")).toBe(1);
  });
  it("covers what each topic promises", () => {
    expect(text(html.okrs!)).toMatch(/Which key result does it move/);
    expect(text(html.okrs!)).toMatch(/Objective/);
    expect(text(html.lifecycle!)).toMatch(/Gate A/);
    expect(text(html.lifecycle!)).toMatch(/Gate C/);
    expect(text(html.lifecycle!)).toMatch(/Go with conditions/);
    expect(text(html.alignment!)).toMatch(/fewer than five voters/);
    expect(text(html.reports!)).toMatch(/Leadership/);
    expect(text(html.delivery!)).toMatch(/GitHub/);
    expect(text(html.delivery!)).toMatch(/Jira/);
    expect(text(html.ai!)).toMatch(/Discovery/);
    expect(text(html.ai!)).toMatch(/PRD/);
  });
  it("lists every phase and status value, with Backlog separate from On hold", () => {
    const t = text(html.statuses!);
    expect(t).toContain("Discover · Define · Build · Test · Experiment · Roll-out · Completed · Sunset");
    expect(t).toContain("Backlog · Active · On hold · Completed · Cancelled");
    expect(t).toContain("On Track · At Risk · Delayed · Blocked");
    expect(t).toContain("Backlog · Not started · Candidate · Included · Committed · Deferred · Dropped");
    expect(t).toContain("Not started · In progress · Done · Cancelled");
    expect(t).toMatch(/never sent to GitHub or Jira/);
    expect(t).toMatch(/Outlined, no fill/);
    expect(t).toMatch(/Dark red/);
  });
  it("never says an AI co-worker approves, and keeps commercial fields out of the trackers", () => {
    for (const [k, h] of Object.entries(html)) expect(text(h), k).not.toMatch(/(Claude|an AI co-worker|AI) (can )?approve[sd]? /i);
    expect(text(html.delivery!)).toMatch(/Never\b/);
    expect(text(html.okrs!)).toMatch(/never sent to GitHub or Jira/);
  });
  it("uses the product name in full and makes no competitor claims", () => {
    for (const [k, h] of Object.entries(html)) {
      const t = text(h);
      expect(t, k).not.toMatch(/\bPV\b|ProductVelocity/);
      expect(t, k).not.toMatch(/\b(the best|number one|world-class|market-leading|unlike [A-Z])/i);
    }
  });
  it("has a Get started page with the route, a checklist and a note for leaders", () => {
    const t = text(html["get-started"]!);
    expect(t).toMatch(/The route/);
    expect(t).toMatch(/First-run checklist/);
    expect(t).toMatch(/A note for leaders/);
    expect(html["get-started"]!).toContain('href="/help/skills"');
  });
  it("shows the figures with text alternatives, labelled as example data", () => {
    for (const k of ["lifecycle", "alignment", "sync-rules", "delivery", "ai-setup", "reports"]) expect(html[k]!, k).toContain("<figure");
    expect(html.lifecycle!).toContain("Go with conditions");
    expect(html.alignment!).toContain("Hidden: fewer than 5 voters");
    expect(html["sync-rules"]!).toContain("Never leaves Product Velocity");
    expect(html.reports!).toContain("Example data");
  });
  it("has an index entry and a page for every skill in the catalogue", () => {
    for (const sk of SKILLS) {
      expect(html.skills!, sk.command).toContain(`href="/help/skills/${sk.command}"`);
      const h = renderToStaticMarkup(createElement(SkillHelpPage, { skill: sk }));
      const t = text(h);
      expect(h.match(/<h1[ >]/g), sk.command).toHaveLength(1);
      expect(h, sk.command).toContain('href="/app"');
      expect(t, sk.command).toContain(sk.command);
      expect(t, sk.command).toContain("Skills prepare; people decide");
      for (const s of sk.sections) expect(t, `${sk.command} ${s.title}`).toContain(s.title);
      expect(t, sk.command).not.toMatch(/\bPV\b|ProductVelocity/);
    }
  });
  it("shows the stage map with every stage that has a skill, and points the AI pages to the reference", () => {
    expect(text(html.skills!)).toMatch(/Skills by stage/);
    expect(html.ai!).toContain('href="/help/skills"');
    expect(html["ai-use-cases"]!).toContain('href="/help/skills"');
    expect(html["ai-use-cases"]!).not.toContain("Every skill, what it works on and what you get");
  });
});
