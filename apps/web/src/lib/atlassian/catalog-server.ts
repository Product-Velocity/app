import "server-only";
import { jiraProjectDetail, jiraGet } from "./server";
import type { JiraField, JiraIssueSample } from "./field-catalog";
import { priorityChoices } from "./field-map";
import { jiraCatalogGroups, type TrackerCatalog } from "@/lib/tracker-fields/catalog";

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
