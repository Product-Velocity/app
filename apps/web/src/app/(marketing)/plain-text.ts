/** The homepage sections as plain text (the llms-full convention), built from the same markup as the page so the two cannot drift apart.
 *  Headings, lead paragraphs and bullet lists only; the product pictures (example data) are left out. */
const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&rarr;/g, "->").replace(/&#9873;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function sectionText(html: string): string {
  const h2 = /<h2>([\s\S]*?)<\/h2>/.exec(html)?.[1];
  const eyebrow = /<span class="eyebrow">([\s\S]*?)<\/span>/.exec(html)?.[1];
  const lead = /<p class="lead2">([\s\S]*?)<\/p>/.exec(html)?.[1];
  const items = [...(/<ul>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => `- ${decode(m[1]!)}`);
  return [h2 && `## ${decode(h2)}`, eyebrow && `(${decode(eyebrow)})`, lead && decode(lead), items.join("\n")].filter(Boolean).join("\n\n");
}

