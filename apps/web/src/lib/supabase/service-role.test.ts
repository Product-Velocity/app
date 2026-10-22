import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ADMIN = path.join(SRC, "lib/supabase/admin.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith(".test.ts"));

describe("service-role key stays server-side", () => {
  it("is referenced only in lib/supabase/admin.ts", () => {
    const users = files.filter((f) => readFileSync(f, "utf8").includes("SERVICE_ROLE"));
    expect(users).toEqual([ADMIN]);
  });

  it("admin.ts is marked server-only", () => {
    expect(readFileSync(ADMIN, "utf8")).toMatch(/^import "server-only";/m);
  });

  it("no client component imports the admin client", () => {
    const offenders = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /^["']use client["']/m.test(s) && /supabase\/admin/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it("is never exposed through a NEXT_PUBLIC_ variable", () => {
    const bad = files.filter((f) => /NEXT_PUBLIC_[A-Z_]*SERVICE/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
