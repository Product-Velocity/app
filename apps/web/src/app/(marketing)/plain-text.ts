/** The homepage sections as plain text (the llms-full convention), built from the same markup as the page so the two cannot drift apart.
 *  Headings, paragraphs, bullet lists and the short cards; the product pictures (example data) are left out. */
const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&rarr;/g, "->").replace(/&#9873;/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function sectionText(html: string): string {
  const h2 = /<h2>([\s\S]*?)<\/h2>/.exec(html)?.[1];
  const eyebrow = /<span class="(?:eyebrow|label)">([\s\S]*?)<\/span>/.exec(html)?.[1];
  const lead = /<p class="lead2">([\s\S]*?)<\/p>/.exec(html)?.[1];
  // paragraphs in the heading block: those before the first picture, card or list
  const intro = lead ? [] : [...(/<\/h2>([\s\S]*?)(?:<ul>|<div class="(?:dots|tree|how|who|trust|mc|reps|uc-tabs)")/.exec(html)?.[1] ?? "").matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]!)).filter(Boolean);
  const items = [...(/<ul>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => `- ${decode(m[1]!)}`);
  const columns = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => `### ${decode(m[1]!)}\n${decode(m[2]!)}`);
  const cards = [...html.matchAll(/<div class="mc[^"]*"><h4>([\s\S]*?)<\/h4><span>([\s\S]*?)<\/span><\/div>/g)].map((m) => `- ${decode(m[1]!)}: ${decode(m[2]!)}`);
  const trust = [...(/<div class="trust">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? "").matchAll(/<div>([\s\S]*?)<\/div>/g)].map((m) => `- ${decode(m[1]!)}`);
  return [h2 && `## ${decode(h2)}`, eyebrow && `(${decode(eyebrow)})`, lead && decode(lead), ...intro, items.join("\n"), columns.join("\n\n"), cards.join("\n"), trust.join("\n")].filter(Boolean).join("\n\n");
}

/** The use-case panels: who does what in each job. */
export function useCaseText(head: string, panels: { k: string; html: string }[]): string {
  const roles = (html: string) => [...html.matchAll(/<div(?: class="you")?><b>([\s\S]*?)<\/b><span[^>]*>([\s\S]*?)<\/span><\/div>/g)].map((m) => `${decode(m[1]!)}: ${decode(m[2]!)}`).join(" ");
  return [sectionText(head), ...panels.map((p) => `### ${p.k}\n${roles(p.html)}`)].join("\n\n");
}
