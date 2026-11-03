import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs runner
import { MIGRATIONS_DIR } from "../src/migrate.mjs";

// Issue #289: the write source is "MCP". Migration 20261103004500 rewrote every older rule that named "Claude MCP". A migration that sorts AFTER it
// and still writes that literal would bring the old name back: its check constraints would refuse "MCP" and its guards (`write_source() = 'Claude MCP'`)
// would never match, so an assistant could slip past them. Use 'MCP' in new migrations.
const RENAME = "20261103004500_mcp_source_and_ai_name.sql";

describe("no migration after the source rename uses the old source name", () => {
  const dir = MIGRATIONS_DIR as string;
  const later = readdirSync(dir).filter((f) => f.endsWith(".sql") && f > RENAME);
  it("checks the migrations that sort after it", () => {
    for (const f of later) {
      expect(readFileSync(path.join(dir, f), "utf8").includes("'Claude MCP'"), `${f} names 'Claude MCP': write 'MCP'`).toBe(false);
    }
  });
});
