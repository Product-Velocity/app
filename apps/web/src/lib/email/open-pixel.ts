/**
 * Open tracking for a few of our own emails (issue #634, docs/decisions/2026-11-23-email-open-and-usage-tracking.md).
 * One 1x1 image whose address holds only the send-log row id (a random UUID: no address, no name, no workspace). Only templates that say
 * `trackOpens` carry it; the alignment emails to voters and every sign-in, confirmation and reset email never do (a test pins that).
 * Pure helpers here; the route that serves the image is app/api/e/o/[id]/route.ts and the send is lib/email/send.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** On unless EMAIL_OPEN_TRACKING is "off": a switch for the day it has to stop at once. */
export const openTrackingOn = () => process.env.EMAIL_OPEN_TRACKING !== "off";

export const pixelUrl = (site: string, id: string) => `${site.replace(/\/+$/, "")}/api/e/o/${id}`;

/** Adds the image just before the end of the page; alt text is empty and the image is not shown. Text parts are left alone. */
export function injectPixel(html: string, url: string): string {
  const img = `<img src="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}\n</body>`) : html + img;
}

/** A 1x1 transparent GIF. */
export const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
