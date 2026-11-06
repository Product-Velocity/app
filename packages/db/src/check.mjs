import { compareMigrations } from "./pending.mjs";

// The deploy-time check (issue #344, docs/decisions/2026-11-06-migration-check.md). Runs in the Vercel build (apps/web `prebuild`), where the
// Supabase URL and service-role key already exist. It fails the build ONLY when it managed to read the recorded migrations and some are
// really pending (or an applied file was edited): a failed production build keeps the previous deployment live, so code that needs an unapplied
// migration never replaces code that works. When it cannot check (no credentials, network, function missing) it says so and lets the build pass.
//
// MIGRATION_CHECK = warn (default: report, never fail) | enforce (fail on pending) | off (skip). Set `enforce` on Vercel Production only.

export const MODES = ["warn", "enforce", "off"];

export async function readApplied(env, fetchFn) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, why: "no Supabase URL or service-role key in this environment" };
  let res;
  try {
    res = await fetchFn(`${url.replace(/\/$/, "")}/rest/v1/rpc/schema_migrations_applied`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    return { ok: false, why: "the database could not be reached" };
  }
  if (res.status === 404) return { ok: false, why: "public.schema_migrations_applied() does not exist yet (apply migration schema_migrations_status first)" };
  if (!res.ok) return { ok: false, why: `the database answered HTTP ${res.status}` };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, why: "the database answered something unexpected" };
  return { ok: true, applied: rows.map((r) => ({ name: String(r.name), checksum: String(r.checksum) })) };
}

/** Returns { exit, lines }: exit 1 only for enforce + a successful read + pending or edited migrations. Never prints secrets or row data. */
export async function runCheck({ env, files, fetchFn = fetch }) {
  const mode = env.MIGRATION_CHECK || "warn";
  if (!MODES.includes(mode)) return { exit: 1, lines: [`MIGRATION_CHECK=${mode} is not one of ${MODES.join(", ")}.`] };
  if (mode === "off") return { exit: 0, lines: ["Migration check: off."] };
  const read = await readApplied(env, fetchFn);
  if (!read.ok) return { exit: 0, lines: [`Migration check skipped: ${read.why}. The build continues.`] };
  const { pending, edited } = compareMigrations(files, read.applied);
  if (pending.length === 0 && edited.length === 0) return { exit: 0, lines: [`Migration check: the database has all ${files.length} migrations.`] };
  const lines = [];
  if (pending.length) lines.push(`${pending.length} migration(s) are not applied to this database:`, ...pending.map((n) => `  - ${n}`));
  if (edited.length) lines.push(`${edited.length} applied migration(s) were edited afterwards (add a new migration instead):`, ...edited.map((n) => `  - ${n}`));
  lines.push("Apply them (docs/11-ENVIRONMENTS.md) and deploy again, or record them with `pnpm db:backfill-sql` if they were applied by hand.");
  if (mode === "enforce") return { exit: 1, lines: ["Migration check FAILED. The previous deployment stays live.", ...lines] };
  return { exit: 0, lines: ["Migration check (warn only; set MIGRATION_CHECK=enforce on Production to fail the build):", ...lines] };
}
