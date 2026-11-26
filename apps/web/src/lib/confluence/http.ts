import { NextResponse } from "next/server";

/** The status a refusal gets: what the person must fix is 4xx, what Confluence could not do is 502. The words in `error` are for the person. */
export const statusFor = (kind: string): number =>
  ({ invalid: 422, too_long: 422, changed: 409, conflict: 409, edited_here: 409, title_taken: 409, forbidden: 403, gone: 404, reconnect: 409, not_recorded: 500 } as Record<string, number>)[kind] ?? 502;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** The words a database refusal gets (never the database's own text). */
export const saveError = (e: { code?: string } | null): string => (e?.code === "42501" || e?.code === "PV035" ? "you do not have permission to do this" : "the database refused it");
