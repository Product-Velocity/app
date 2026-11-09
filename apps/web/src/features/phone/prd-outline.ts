/** A document split into sections at its top-level headings, for the phone reader (docs/29-MOBILE.md section 4.5). */
export type DocSection = { title: string; body: string; open: boolean };

/**
 * Splits Markdown at "# " and "## " headings (headings inside code fences are ignored). Text before the first heading is kept as an unnamed
 * first section. The first section and any section that mentions "At a glance" start open; the rest are folded.
 */
export function splitSections(md: string): DocSection[] {
  const sections: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = !fenced ? /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) sections.push({ title: h[2]!, lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  const out = sections
    .map((s) => ({ title: s.title, body: s.lines.join("\n").trim() }))
    .filter((s) => s.title !== "" || s.body !== "");
  const named = out.findIndex((s) => s.title !== "");
  return out.map((s, i) => ({ ...s, open: i === named || i === 0 || /at a glance/i.test(`${s.title}\n${s.body}`) }));
}
