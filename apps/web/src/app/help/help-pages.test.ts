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
import SyncRulesHelp from "./sync-rules/page";
import AttentionHelp from "./attention/page";
import ReportDefinitionsHelp from "./report-definitions/page";
import AiUseCasesHelp from "./ai-use-cases/page";

const PAGES: Record<string, () => React.JSX.Element> = {
  "": HelpHome, okrs: OkrsPage, lifecycle: LifecyclePage, alignment: AlignmentPage, reports: ReportsHelp, delivery: DeliveryHelp, ai: AiHelp,
  "ai-setup": AiSetupHelp, columns: ColumnsHelp, shortcuts: ShortcutsHelp, "goal-fields": GoalFieldsHelp, phases: PhasesHelp, "sync-rules": SyncRulesHelp, attention: AttentionHelp,
  "report-definitions": ReportDefinitionsHelp, "ai-use-cases": AiUseCasesHelp,
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
      expect(h, k).toContain('href="/"');
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
});
