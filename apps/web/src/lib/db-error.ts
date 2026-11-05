// A database read that failed must say why (issue: delivery sync "Could not check"). Supabase returns `{ data: null, error }` instead of
// throwing, so a read whose error is not looked at turns into "nothing found" (GitHub: "Not on GitHub", webhook "ignored", 0 checked) or into
// one catch-all text (Jira: "could not be read just now"). The explanation here is safe to show and to store in the sync log: it names the
// part that was read and the Postgres / PostgREST error code, never a row value, a token, an email or a document text.

type PgError = { code?: string | null; message?: string | null } | null | undefined;

/** Codes that mean the code is newer than the database: a column, table or function it reads is not there (a migration is not applied). */
const SCHEMA_CODES = new Set(["42703", "42P01", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);
export const isSchemaDrift = (e: PgError): boolean => !!e?.code && SCHEMA_CODES.has(e.code);

/** Thrown for a failed read; `message` is safe to show to the person. `schemaDrift` = the database is missing an update. */
export class DbReadError extends Error {
  constructor(message: string, readonly code: string | null, readonly schemaDrift: boolean) {
    super(message);
    this.name = "DbReadError";
  }
}

/** The safe explanation of a failed read of `what` (for example "the Jira links"). */
export function explainDbError(what: string, e: PgError): DbReadError {
  const code = e?.code ?? null;
  if (isSchemaDrift(e)) {
    return new DbReadError(`Could not read ${what}: the database is missing an update that this version of Product Velocity needs (error ${code}). Nothing was changed. A platform admin must apply the pending database migrations (docs/11-ENVIRONMENTS.md).`, code, true);
  }
  return new DbReadError(`Could not read ${what}: the database refused the read${code ? ` (error ${code})` : ""}. Nothing was changed. Try again in a minute; if it keeps happening, tell support.`, code, false);
}

/** Returns the rows of a Supabase read, or throws the explanation. Logs the code (not the message text, which can quote a value). */
export function rowsOrThrow<T>(what: string, r: { data: T | null; error: PgError }): T | null {
  if (!r.error) return r.data;
  const x = explainDbError(what, r.error);
  console.error(JSON.stringify({ db: "read-failed", what, code: x.code, schemaDrift: x.schemaDrift }));
  throw x;
}

/** The text for a caught error: a DbReadError keeps its explanation, anything else gets the caller's generic text. */
export const safeReadMessage = (e: unknown, generic: string): string => (e instanceof DbReadError ? e.message : generic);
