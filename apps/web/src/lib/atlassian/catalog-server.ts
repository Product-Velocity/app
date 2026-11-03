import "server-only";
import { jiraProjectDetail, jiraGet } from "./server";
import type { JiraField, JiraIssueSample } from "./field-catalog";
import { priorityChoices, proposePriorities, startDateChoices, themeChoices, type FieldChoice, type Moscow } from "./field-map";
import { jiraCatalogGroups, type CatalogEntry, type TrackerCatalog } from "@/lib/tracker-fields/catalog";

const KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : "unknown reason").slice(0, 200);

/**
 * Reads the field catalog of ONE linked Jira project (decision 2026-11-03-tracker-field-config): the site's fields by id, a sample of the
 * project's 50 most recently updated issues for the fill rate, the priorities and the project's issue types. Reads only. A part that fails
 * is reported in its own group; ReconnectNeeded is not swallowed per part but reported as the same plain reason.
 */
export async function readJiraCatalog(connectionId: string, siteId: string, projectKey: string): Promise<TrackerCatalog> {
  if (!KEY.test(projectKey)) throw new Error("Not a Jira project key");
  const jql = encodeURIComponent(`project = ${projectKey} ORDER BY updated DESC`);
  const [fields, priorities, detail, sample] = await Promise.allSettled([
    jiraGet<JiraField[]>(connectionId, siteId, "/field"),
    jiraGet<unknown>(connectionId, siteId, "/priority"),
    jiraProjectDetail(connectionId, siteId, projectKey),
    jiraGet<{ issues?: JiraIssueSample[] }>(connectionId, siteId, `/search/jql?jql=${jql}&fields=*all&maxResults=50`),
  ]);
  return {
    tracker: "jira", scope: projectKey, readAt: new Date().toISOString(),
    groups: jiraCatalogGroups({
      fields: fields.status === "fulfilled" ? fields.value : null,
      fieldsError: fields.status === "rejected" ? `The fields of this Jira site could not be read just now: ${msg(fields.reason)}.` : null,
      issues: sample.status === "fulfilled" ? (sample.value.issues ?? []) : [],
      sampleError: sample.status === "rejected" ? msg(sample.reason) : null,
      priorities: priorities.status === "fulfilled" ? priorityChoices(priorities.value) : null,
      issueTypes: detail.status === "fulfilled" ? detail.value.issueTypes : null,
    }),
  };
}

export type JiraSiteFields = { startDates: FieldChoice[]; themes: FieldChoice[]; priorities: FieldChoice[]; proposal: Partial<Record<Moscow, string>>; dateFields: CatalogEntry[]; entries: CatalogEntry[] };

/**
 * What a Jira site offers for the field configuration, from ONE read of its fields and priorities: the start date, theme and priority choices, the date
 * fields a due date can go to, and every field as a catalog entry (the list a save is validated against). Throws when the site can not be read.
 */
export async function readJiraSiteFields(connectionId: string, siteId: string): Promise<JiraSiteFields> {
  const [fields, priorities] = await Promise.all([jiraGet<JiraField[]>(connectionId, siteId, "/field"), jiraGet<unknown>(connectionId, siteId, "/priority")]);
  const prio = priorityChoices(priorities);
  const entries = jiraCatalogGroups({ fields, issues: [], priorities: prio, issueTypes: [] })[0]!.entries;
  return { startDates: startDateChoices(fields), themes: themeChoices(fields), priorities: prio, proposal: proposePriorities(prio), dateFields: entries.filter((e) => e.kind === "date" && /^(duedate|customfield_\d{1,9})$/.test(e.id)), entries };
}
