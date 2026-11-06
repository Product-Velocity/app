// What a Sync wrote to the tracker, in words, for the confirmed screen (issue #352). Pure functions over what was sent; nothing is read back from the tracker.

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** GitHub: the sections of the managed block that was written (Summary, Description, Hypothesis, Links, Files, Documents with their counts), the title, labels and milestone. */
export function wroteGithub(p: { title: string; block: string; labels: string[]; milestone?: string | null; board?: { title: string; included: boolean; writes: { field: string; value: string }[] } | undefined }): string[] {
  const out: string[] = ["Title"];
  const sections = p.block.split(/\n(?=## )/).slice(1);
  for (const s of sections) {
    const [head, ...rest] = s.split("\n");
    const name = (head ?? "").replace(/^##\s*/, "").trim();
    const items = rest.filter((l) => l.startsWith("- [")).length;
    if (/^Hypothesis/.test(name)) out.push("Hypothesis");
    else if (name === "Summary" || name === "Description") out.push(name);
    else if (name === "Links" || name === "Artifacts") out.push(`Links (${items})`);
    else if (name === "Files") out.push(`Files (${items})`);
    else if (name === "Documents") out.push(`Documents (${count(items, "link")})`);
  }
  if (p.labels.length > 0) out.push(`Labels (${p.labels.length})`);
  if (p.milestone) out.push(`Milestone ${p.milestone}`);
  if (p.board?.included) out.push(p.board.writes.length > 0 ? `Project board: ${p.board.writes.map((w) => `${w.field} ${w.value}`).join(", ")}` : `Project board "${p.board.title}"`);
  return out;
}

type Node = { type?: string; attrs?: { level?: number }; content?: Node[] };
const textOf = (n: Node): string => (n.content ?? []).map((c) => (c as { text?: string }).text ?? textOf(c)).join("");

/** Jira: the fields sent. The description is read by its level-2 headings (Summary, Description, Hypothesis, Links, Files, Documents), each link section with its count. */
export function wroteJira(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  if ("summary" in fields) out.push("Name");
  const d = fields.description as { content?: Node[] } | undefined;
  if (d?.content) {
    let current = "";
    for (const n of d.content) {
      if (n.type === "heading" && n.attrs?.level === 2) {
        current = textOf(n).trim();
        if (/^Hypothesis/.test(current)) out.push("Hypothesis");
        else if (current === "Summary" || current === "Description") out.push(current);
        continue;
      }
      if (n.type === "bulletList") {
        const items = (n.content ?? []).length;
        if (current === "Links" || current === "Artifacts") out.push(`Links (${items})`);
        else if (current === "Files") out.push(`Files (${items})`);
        else if (current === "Documents") out.push(`Documents (${count(items, "link")})`);
      }
    }
    if (!out.some((x) => /^(Summary|Description|Hypothesis|Links|Files|Documents)/.test(x))) out.push("Description");
  }
  if (Array.isArray(fields.labels)) out.push(`Labels (${fields.labels.length})`);
  if ("duedate" in fields) out.push("Due date");
  if ("priority" in fields) out.push("Priority");
  if ("parent" in fields) out.push("Parent issue");
  return out;
}
