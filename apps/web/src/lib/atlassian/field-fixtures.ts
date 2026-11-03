import type { JiraField } from "./field-catalog";

// Fictional fixtures shaped like the J2 results (docs/08): a site with duplicate field names, Team and Parent as objects, Product Discovery fields.
export const SITE_FIELDS: JiraField[] = [
  { id: "summary", name: "Summary", custom: false, schema: { type: "string", system: "summary" } },
  { id: "status", name: "Status", custom: false, schema: { type: "status", system: "status" } },
  { id: "labels", name: "Labels", custom: false, schema: { type: "array", items: "string", system: "labels" } },
  { id: "duedate", name: "Due date", custom: false, schema: { type: "date", system: "duedate" } },
  { id: "priority", name: "Priority", custom: false, schema: { type: "priority", system: "priority" } },
  { id: "assignee", name: "Assignee", custom: false, schema: { type: "user", system: "assignee" } },
  { id: "parent", name: "Parent", custom: false, schema: { type: "issuelink", system: "parent" } },
  { id: "customfield_10015", name: "Start date", custom: true, schema: { type: "date", custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker", customId: 10015 } },
  { id: "customfield_10016", name: "Story point estimate", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:float", customId: 10016 } },
  { id: "customfield_10001", name: "Team", custom: true, schema: { type: "team", custom: "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team", customId: 10001 } },
  { id: "customfield_10020", name: "Sprint", custom: true, schema: { type: "array", items: "json", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10020 } },
  { id: "customfield_10100", name: "Vulnerability", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select", customId: 10100 } },
  { id: "customfield_10101", name: "Vulnerability", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield", customId: 10101 } },
  { id: "customfield_10200", name: "Impact", custom: true, schema: { type: "any", custom: "com.atlassian.jpd:impact", customId: 10200 } },
];
export const SAMPLE = [{ fields: { summary: "A", customfield_10015: "2026-12-01", customfield_10001: { id: "t", name: "Payments" } } }, { fields: { summary: "B" } }];
