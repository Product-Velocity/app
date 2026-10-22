export type Command = { id: string; label: string; hint?: string; group: string; keywords?: string; run: () => void };

/** Commands whose text contains every typed word, best match first (earlier and whole-word matches rank higher). */
export function rankCommands<T extends { label: string; keywords?: string; group: string }>(commands: T[], query: string, limit = 12): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands.slice(0, limit);
  const scored: { c: T; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = c.label.toLowerCase();
    const hay = `${label} ${(c.keywords ?? "").toLowerCase()} ${c.group.toLowerCase()}`;
    let score = 0;
    for (const w of words) {
      const at = label.indexOf(w);
      if (at >= 0) score += at === 0 ? 3 : label[at - 1] === " " ? 2 : 1;
      else if (hay.includes(w)) score += 0.5;
      else return;
    }
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.c);
}
