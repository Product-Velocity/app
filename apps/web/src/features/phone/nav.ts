/** Phone navigation (docs/29-MOBILE.md section 3, reworked by issue #635). Pure, so it can be tested without a browser. */
export type PhoneTab = { id: "initiatives" | "decide" | "add" | "tracker" | "insights"; label: string; href: string };

/** The bottom bar: Initiatives (what changed, search), Decide (gates and alignment results), the ＋ quick-add button in the middle, Tracker, Insights. */
export const PHONE_TABS: PhoneTab[] = [
  { id: "initiatives", label: "Initiatives", href: "/cards" },
  { id: "decide", label: "Decide", href: "/decisions" },
  { id: "add", label: "＋ Add", href: "/new" },
  { id: "tracker", label: "Tracker", href: "/tracker" },
  { id: "insights", label: "Insights", href: "/leadership" },
];

/** Which bottom-bar item is current for a page (path without the /w/{account} prefix). */
export function phoneTabFor(path: string): PhoneTab["id"] | null {
  if (path.startsWith("/new")) return "add";
  if (path.startsWith("/cards") || path.startsWith("/portfolio") || path.startsWith("/gantt") || path.startsWith("/for-you") || path.startsWith("/attention") || path.startsWith("/home")) return "initiatives";
  if (path.startsWith("/decisions") || path.startsWith("/alignment")) return "decide";
  if (path.startsWith("/tracker")) return "tracker";
  if (path.startsWith("/leadership") || path.startsWith("/reports")) return "insights";
  return null;
}

/** The More screen (account, help and the shortcuts that are no longer in the bar). Only what works on a phone is listed. */
export type MoreEntry = { label: string; href: string; note: string };
export const MORE_ENTRIES: MoreEntry[] = [
  { label: "For you", href: "/for-you", note: "Gates waiting for you, what needs attention, your placeholders" },
  { label: "Needs attention", href: "/attention", note: "What is stuck, late or missing" },
  { label: "Alignment", href: "/alignment", note: "Sessions and results" },
  { label: "Reports", href: "/reports", note: "Roadmap health and gate history" },
  { label: "Account", href: "/account", note: "Profile, sign-in methods, 2FA" },
  { label: "Help", href: "/help", note: "Guides and answers" },
];
