/**
 * The facts the public pages (/connector, /privacy) and the directory submission state: who to write to and where the connector lives.
 * One place, so the two pages and docs/decisions/2026-11-17-connector-directory.md cannot disagree.
 */
export const SUPPORT_CONTACT = { name: "Ashu Mathura", email: "ashu.mathura@gmail.com" } as const;

/** The production address of the connector. A preview deployment has its own address; the public pages always show this one. */
export const CONNECTOR_URL = "https://productvelocity.app/mcp";

/** Shown at the top of the privacy policy; change it when the text changes. */
export const PRIVACY_UPDATED = "17 November 2026";
