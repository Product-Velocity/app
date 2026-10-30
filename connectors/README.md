# Connectors

Product Velocity has one MCP server (`/mcp`); these files only help set up an assistant by hand. They are generated from the server's own rules, flows and tool names and checked by `apps/web/src/lib/mcp/connector-files.test.ts`. After changing a rule, flow or tool: `UPDATE_CONNECTORS=1 pnpm --filter web test connector-files`.

- `gemini/`: a Gemini CLI extension (`gemini-extension.json`, `GEMINI.md`). Replace `YOUR-PRODUCT-VELOCITY-DOMAIN` with your deployment before installing.
- `chatgpt/README.md`: ChatGPT Developer-mode setup.
- Claude: see Connect an AI assistant in the app.

Design and status: `docs/27-AI-ASSISTANTS-AND-MEMORY.md`. Not tested against live clients yet (spike S8c).
