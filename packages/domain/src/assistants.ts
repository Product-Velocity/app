// AI assistants that can connect to /mcp (docs/27-AI-ASSISTANTS-AND-MEMORY.md). The server is one and the same for all of them: the same tools,
// prompts, rules and role checks. This file only knows the small differences between clients: how to recognise them, what they can and cannot
// do with MCP, and how a person connects them. Pure: no database, no tool code.

export type Assistant = "claude" | "chatgpt" | "gemini" | "other";
export const ASSISTANT_IDS: readonly Assistant[] = ["claude", "chatgpt", "gemini", "other"];

export type AssistantInfo = {
  id: Assistant;
  /** The product name as people say it. */
  label: string;
  /** Can the client start MCP prompts (slash commands)? When it cannot, `get_playbook` gives the same text as a tool call. */
  prompts: boolean;
  /** Needs the plain `search` and `fetch` tools (ChatGPT deep research and company knowledge only use those two). */
  searchFetch: boolean;
  /** Accepts only a small subset of JSON Schema in tool definitions, so the schemas are simplified for it. */
  simpleSchemas: boolean;
};

export const ASSISTANT_INFO: Readonly<Record<Assistant, AssistantInfo>> = {
  claude: { id: "claude", label: "Claude", prompts: true, searchFetch: false, simpleSchemas: false },
  chatgpt: { id: "chatgpt", label: "ChatGPT", prompts: false, searchFetch: true, simpleSchemas: false },
  gemini: { id: "gemini", label: "Gemini", prompts: true, searchFetch: false, simpleSchemas: true },
  other: { id: "other", label: "your AI assistant", prompts: false, searchFetch: false, simpleSchemas: false },
};

/**
 * Which assistant a client is, from the name it registered with at the OAuth server ("Claude", "Claude Code (product-velocity)", "ChatGPT",
 * "Gemini CLI MCP Client") or from its User-Agent. The first name that says something wins. This is a label for the person and a hint for
 * how to present tools, never a permission: every client gets the same role checks. The SQL function `assistant_of` mirrors these patterns
 * (a test keeps them in step).
 */
export function detectAssistant(...names: (string | null | undefined)[]): Assistant {
  for (const raw of names) {
    const n = (raw ?? "").toLowerCase();
    if (!n) continue;
    if (/claude|anthropic/.test(n)) return "claude";
    if (/chatgpt|openai|gpt/.test(n)) return "chatgpt";
    if (/gemini|google/.test(n)) return "gemini";
  }
  return "other";
}

export const assistantLabel = (a: Assistant): string => ASSISTANT_INFO[a].label;

export type SetupGuide = { assistant: Assistant; title: string; steps: string[]; snippet?: { label: string; code: string }; note?: string };

/** How a person connects each assistant. `url` is this deployment's connector address. Menu names move between releases, so each guide says what to look for. */
export function setupGuides(url: string): SetupGuide[] {
  return [
    {
      assistant: "claude",
      title: "Claude (claude.ai, desktop app, Claude Code)",
      steps: [
        "claude.ai or the desktop app: open Settings, then Connectors, and choose Add custom connector. Paste the connector URL and name it Product Velocity.",
        "Connect, sign in if asked, choose one or several workspaces and approve on the consent screen.",
        "Claude Code: run the command below, then run /mcp in Claude Code, choose product-velocity and authenticate.",
      ],
      snippet: { label: "Claude Code", code: `claude mcp add --transport http product-velocity ${url}` },
    },
    {
      assistant: "chatgpt",
      title: "ChatGPT",
      steps: [
        "In ChatGPT open Settings, then Apps and Connectors, then Advanced settings, and turn on Developer mode. On Business, Enterprise and Edu plans a ChatGPT workspace admin has to allow custom connectors first.",
        "Back under Connectors choose Create, name it Product Velocity, paste the connector URL as the MCP server URL and choose OAuth as the authentication.",
        "Connect, sign in to Product Velocity, choose one or several workspaces and approve on the consent screen.",
        "In a new chat, add the Product Velocity connector from the + menu (Developer mode). ChatGPT asks you to confirm each tool call that changes something.",
      ],
      note: "ChatGPT cannot start prompts, so say \"use the write_prd playbook\" or simply describe what you want; the assistant reads the same instructions through the get_playbook tool. Deep research and company knowledge use the search and fetch tools, which are read-only.",
    },
    {
      assistant: "gemini",
      title: "Gemini (Gemini CLI and Code Assist agent mode)",
      steps: [
        "Add the server with the command below, or paste the settings snippet into ~/.gemini/settings.json (or .gemini/settings.json in a project).",
        "Run gemini, then /mcp auth product-velocity. A browser window opens: sign in to Product Velocity, choose one or several workspaces and approve.",
        "The Product Velocity prompts (write_prd, write_discovery, review_group, research_company) appear as slash commands: type / to see them.",
      ],
      snippet: {
        label: "Gemini CLI",
        code: `gemini mcp add --transport http product-velocity ${url}\n\n# or in settings.json:\n{\n  "mcpServers": {\n    "product-velocity": { "httpUrl": "${url}" }\n  }\n}`,
      },
      note: "The consumer Gemini app has no custom MCP connectors today. Other Gemini clients that speak remote MCP with OAuth (the Gemini API's MCP support, Agent Development Kit) can use the same URL.",
    },
  ];
}
