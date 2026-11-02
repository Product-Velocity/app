// Spike J4 (#257): can Product Velocity write to Jira the way the sync needs to? Creates a test Epic and a child
// Story in one software project, changes them, moves the child through a workflow transition, reads them back and
// ALWAYS deletes both again. Pure logic over an injected `call`, so it is tested without a network.

export type JiraCall = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
export type WriteStep = { label: string; status: number; note: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

export const TEST_LABEL = "pv-spike";

/** Minimal Atlassian Document Format: paragraphs, optional bold text, and a bullet list. */
export function adf(paragraphs: string[], bullets: string[] = []): unknown {
  const content: unknown[] = paragraphs.map((t, i) => ({ type: "paragraph", content: [{ type: "text", text: t, ...(i === 0 ? { marks: [{ type: "strong" }] } : {}) }] }));
  if (bullets.length) content.push({ type: "bulletList", content: bullets.map((b) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: b }] }] })) });
  return { type: "doc", version: 1, content };
}

/** The node types in order, to see whether Jira kept the structure we sent. */
export function adfShape(doc: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    const o = obj(n);
    if (typeof o.type === "string") out.push(o.type + (Array.isArray(o.marks) && o.marks.length ? `[${(o.marks as Obj[]).map((m) => m.type).join("+")}]` : ""));
    if (Array.isArray(o.content)) o.content.forEach(walk);
  };
  walk(doc);
  return out.join(" > ");
}

function why(json: unknown): string {
  const o = obj(json);
  const parts = [...(Array.isArray(o.errorMessages) ? (o.errorMessages as string[]) : []), ...Object.entries(obj(o.errors)).map(([k, v]) => `${k}: ${String(v)}`)];
  return parts.join("; ").slice(0, 300);
}

export async function runWriteTest(call: JiraCall, projectKey: string): Promise<WriteStep[]> {
  const steps: WriteStep[] = [];
  const created: string[] = [];
  const step = async (label: string, fn: () => Promise<{ status: number; note: string }>) => {
    try {
      const r = await fn();
      steps.push({ label, ...r });
    } catch (e) {
      steps.push({ label, status: 0, note: e instanceof Error ? e.message : String(e) });
    }
  };
  let epicKey = "";
  let childKey = "";
  try {
    const types = await call("GET", `/project/${projectKey}`);
    const list = (Array.isArray(obj(types.json).issueTypes) ? (obj(types.json).issueTypes as Obj[]) : []).map((t) => ({ id: String(t.id), name: String(t.name), level: Number(t.hierarchyLevel), subtask: Boolean(t.subtask) }));
    const epicType = list.find((t) => t.level === 1);
    const storyType = list.find((t) => t.name === "Story") ?? list.find((t) => t.level === 0 && !t.subtask);
    steps.push({ label: "Issue types of the test project", status: types.status, note: list.map((t) => `${t.name} (level ${t.level})`).join(", ") });
    if (!epicType || !storyType) {
      steps.push({ label: "Stop", status: 0, note: "The project has no Epic type or no level-0 type; nothing was written." });
      return steps;
    }

    await step("Create Epic with a description, a bold line, a bullet list and a label", async () => {
      const r = await call("POST", "/issue", { fields: { project: { key: projectKey }, issuetype: { id: epicType.id }, summary: "PV spike J4 test epic (safe to delete)", labels: [TEST_LABEL], description: adf(["Written by Product Velocity spike J4."], ["first point", "second point"]) } });
      epicKey = String(obj(r.json).key ?? "");
      if (epicKey) created.push(epicKey);
      return { status: r.status, note: epicKey ? `created ${epicKey}` : why(r.json) };
    });
    if (epicKey) {
      await step("Create a child Story under the Epic (parent field)", async () => {
        const r = await call("POST", "/issue", { fields: { project: { key: projectKey }, issuetype: { id: storyType.id }, parent: { key: epicKey }, summary: "PV spike J4 test story (safe to delete)", labels: [TEST_LABEL] } });
        childKey = String(obj(r.json).key ?? "");
        if (childKey) created.push(childKey);
        return { status: r.status, note: childKey ? `created ${childKey} under ${epicKey}` : why(r.json) };
      });
      await step("Update the Epic: new label and a new description", async () => {
        const r = await call("PUT", `/issue/${epicKey}`, { fields: { labels: [TEST_LABEL, "pv-updated"], description: adf(["Second version written by spike J4."], ["only point"]) } });
        return { status: r.status, note: r.status === 204 ? "updated" : why(r.json) };
      });
    }
    if (childKey) {
      await step("Set Story points on the child (custom field)", async () => {
        const f = await call("GET", "/field");
        const field = (Array.isArray(f.json) ? (f.json as Obj[]) : []).find((x) => /^story point/i.test(String(x.name)));
        if (!field) return { status: f.status, note: "no Story points field on this site" };
        const r = await call("PUT", `/issue/${childKey}`, { fields: { [String(field.id)]: 3 } });
        return { status: r.status, note: r.status === 204 ? `set ${String(field.id)} = 3` : why(r.json) };
      });
      await step("Workflow: list transitions, then do one", async () => {
        const t = await call("GET", `/issue/${childKey}/transitions`);
        const ts = (Array.isArray(obj(t.json).transitions) ? (obj(t.json).transitions as Obj[]) : []).map((x) => ({ id: String(x.id), name: String(x.name), to: String(obj(obj(x.to).statusCategory).key ?? "?") }));
        const pick = ts.find((x) => x.to === "indeterminate") ?? ts[0];
        if (!pick) return { status: t.status, note: "no transitions available" };
        const r = await call("POST", `/issue/${childKey}/transitions`, { transition: { id: pick.id } });
        return { status: r.status, note: `${r.status === 204 ? "moved with" : "refused"} "${pick.name}"; offered: ${ts.map((x) => `${x.name} -> ${x.to}`).join(", ")}${r.status === 204 ? "" : ` (${why(r.json)})`}` };
      });
    }
    if (epicKey) {
      await step("Read back: description, labels and parent", async () => {
        const e = await call("GET", `/issue/${epicKey}?fields=description,labels`);
        const c = childKey ? await call("GET", `/issue/${childKey}?fields=parent,status`) : null;
        const ef = obj(obj(e.json).fields);
        const sentShape = adfShape(adf(["Second version written by spike J4."], ["only point"]));
        const gotShape = adfShape(ef.description);
        const parent = c ? String(obj(obj(obj(c.json).fields).parent).key ?? "none") : "n/a";
        return { status: e.status, note: `labels: ${(Array.isArray(ef.labels) ? ef.labels : []).join(", ")}\nparent of child: ${parent}\ndescription structure ${sentShape === gotShape ? "identical" : "CHANGED"}\n  sent: ${sentShape}\n  got:  ${gotShape}` };
      });
    }
  } finally {
    for (const key of [...created].reverse()) {
      await step(`Delete ${key}`, async () => {
        const r = await call("DELETE", `/issue/${key}?deleteSubtasks=true`);
        return { status: r.status, note: r.status === 204 ? "deleted" : `NOT deleted, remove it by hand (${why(r.json)})` };
      });
    }
  }
  return steps;
}
