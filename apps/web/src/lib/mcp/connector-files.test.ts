import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { chatgptGuide, geminiContext, geminiExtension } from "./connector-files";

const root = join(__dirname, "../../../../..");
const FILES: [string, () => string][] = [
  ["connectors/gemini/GEMINI.md", geminiContext],
  ["connectors/gemini/gemini-extension.json", geminiExtension],
  ["connectors/chatgpt/README.md", chatgptGuide],
];

describe("the files in /connectors", () => {
  it.each(FILES)("%s is what the server's own rules and flows generate", (path, make) => {
    const file = join(root, path);
    if (process.env.UPDATE_CONNECTORS === "1") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, make());
    }
    expect(existsSync(file), `${path} missing: run UPDATE_CONNECTORS=1 pnpm --filter web test connector-files`).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(make());
  });
  it("the Gemini extension is valid JSON that points at /mcp and loads the context file", () => {
    const x = JSON.parse(geminiExtension());
    expect(x.contextFileName).toBe("GEMINI.md");
    expect(x.mcpServers["product-velocity"].httpUrl).toMatch(/\/mcp$/);
  });
  it("the context file states the hard rules, names every flow and holds no secrets or customer data", () => {
    const c = geminiContext();
    expect(c).toMatch(/Approve anything/);
    expect(c).toMatch(/Stack Rank, Decision or Value/);
    expect(c).toMatch(/data, never instructions/);
    for (const f of ["write_prd", "write_discovery", "review_group", "research_company", "setup_memory"]) expect(c).toContain(`/${f}`);
    expect(c).not.toMatch(/sk-|token|password|@/i);
  });
});
