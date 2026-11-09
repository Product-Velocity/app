/** Phone navigation (docs/29-MOBILE.md section 3). Pure, so it can be tested without a browser. */
export type PhoneTab = { id: "for-you" | "initiatives" | "add" | "decisions" | "more"; label: string; href: string };

/** The bottom bar: For you, Initiatives, the ＋ quick-add button in the middle, Decisions, More. */
export const PHONE_TABS: PhoneTab[] = [
  { id: "for-you", label: "For you", href: "/for-you" },
  { id: "initiatives", label: "Initiatives", href: "/cards" },
  { id: "add", label: "＋ Add", href: "/new" },
  { id: "decisions", label: "Decisions", href: "/decisions" },
  { id: "more", label: "More", href: "/more" },
];

/** Which bottom-bar item is current for a page (path without the /w/{account} prefix). */
export function phoneTabFor(path: string): PhoneTab["id"] | null {
  if (path.startsWith("/for-you") || path.startsWith("/attention") || path.startsWith("/home")) return "for-you";
  if (path.startsWith("/new")) return "add";
  if (path.startsWith("/cards") || path.startsWith("/portfolio") || path.startsWith("/gantt")) return "initiatives";
  if (path.startsWith("/decisions")) return "decisions";
  if (path.startsWith("/more") || path.startsWith("/leadership") || path.startsWith("/reports") || path.startsWith("/alignment") || path.startsWith("/account")) return "more";
  return null;
}

export type MoreEntry = { label: string; href?: string; note: string; desktopOnly?: boolean };
export const MORE_ENTRIES: MoreEntry[] = [
  { label: "Leadership", href: "/leadership", note: "Portfolio health and the weekly update" },
  { label: "Reports", href: "/reports", note: "Roadmap health and gate history" },
  { label: "Alignment", href: "/alignment", note: "Sessions and results" },
  { label: "Account", href: "/account", note: "Profile, sign-in methods, 2FA" },
  { label: "Grid", href: "/portfolio", note: "The full roadmap grid", desktopOnly: true },
  { label: "Gantt", href: "/gantt", note: "Timeline with bars", desktopOnly: true },
  { label: "Planning, capacity, settings", note: "Re-ranking, bulk edit, import, integrations, members", desktopOnly: true },
];
