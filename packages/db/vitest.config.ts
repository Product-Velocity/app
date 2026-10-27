import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The MCP scenario test drives the real tool code of apps/web against the real migrations, so it needs the workspace packages.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@pv/domain": src("../domain/src/index.ts"), "@pv/github": src("../github/src/index.ts") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
