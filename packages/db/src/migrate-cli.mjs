import pg from "pg";
import { migrate } from "./migrate.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (Supabase: Project Settings > Database > Connection string, direct or session pooler).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const done = await migrate(client, undefined, (m) => console.log(m));
  console.log(done.length ? `Done: ${done.length} applied.` : "Up to date.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
