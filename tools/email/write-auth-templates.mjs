// Writes apps/web/email-templates/*.html from apps/web/src/lib/email/auth-templates.ts (issue #357).
// Run with: pnpm email:templates
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTH_TEMPLATES } from "../../apps/web/src/lib/email/auth-templates.ts";

const dir = fileURLToPath(new URL("../../apps/web/email-templates/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const t of AUTH_TEMPLATES) {
  writeFileSync(dir + t.file, t.html);
  console.log(`wrote ${t.file}  (subject: ${t.subject})`);
}
