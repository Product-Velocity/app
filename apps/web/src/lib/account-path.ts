/**
 * The account is part of the address: /w/{account}/{page}. The proxy strips the prefix and passes the account on as a header, so every page
 * keeps its normal route and switching accounts keeps the current tab (R-111 FR-1.3). The check that the person may open the account is
 * made by requireWorkspace(), never here.
 */
const PREFIX = /^\/w\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;

export const DEFAULT_PAGE = "/portfolio";

export function parseAccountPath(pathname: string): { tenantId: string; rest: string } | null {
  const m = PREFIX.exec(pathname);
  if (!m) return null;
  const rest = m[2] && m[2] !== "/" ? m[2] : DEFAULT_PAGE;
  return { tenantId: m[1]!.toLowerCase(), rest };
}

/** The page without any account prefix, for links that must keep the tab. */
export function stripAccountPath(pathname: string): string {
  return parseAccountPath(pathname)?.rest ?? pathname;
}

/** The same page in another account. Keeps the tab and the query string (a saved scope belongs to the account, so callers may drop it). */
export function accountHref(tenantId: string, pathname: string, search = ""): string {
  const page = stripAccountPath(pathname);
  const target = page === "/" || page === "" ? DEFAULT_PAGE : page;
  return `/w/${tenantId}${target}${search}`;
}

/** Tabs that exist in every account. Anything else (an item, a setting) falls back to the grid when the account changes, as ids are per account. */
const TAB_ROOTS = ["/portfolio", "/gantt", "/cards", "/leadership", "/alignment", "/settings", "/account", "/trash", "/home", "/incoming"];
export function tabHref(tenantId: string, pathname: string): string {
  const page = stripAccountPath(pathname);
  const root = TAB_ROOTS.find((r) => page === r || page.startsWith(`${r}/`));
  if (!root) return `/w/${tenantId}${DEFAULT_PAGE}`;
  const perAccountId = root === "/portfolio" || root === "/alignment"; // /portfolio/{item}, /alignment/{session}
  return `/w/${tenantId}${perAccountId ? root : page}`;
}

const SCREEN: [string, string][] = [
  ["/portfolio", "grid"], ["/gantt", "gantt"], ["/cards", "cards"], ["/leadership", "leadership"], ["/alignment", "alignment"],
  ["/settings/members", "members"], ["/settings/workspace", "workspace-settings"], ["/settings/integrations", "integrations"], ["/settings", "settings"],
  ["/account", "account"], ["/incoming", "incoming"], ["/trash", "trash"], ["/platform", "platform"],
];

/** A short label for the audit log: which screen a change came from. Advisory context only; it grants nothing. */
export function screenOf(pathname: string): string | null {
  const page = stripAccountPath(pathname);
  return SCREEN.find(([root]) => page === root || page.startsWith(`${root}/`))?.[1] ?? null;
}
