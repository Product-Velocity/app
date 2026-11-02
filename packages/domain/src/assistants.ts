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
        "Copy the connector URL.",
        "In Claude (claude.ai or the desktop app) open Settings, then Connectors, choose Add custom connector, paste the URL and name it Product Velocity.",
        "Choose Connect, sign in, pick one or several workspaces and approve. That is all; there is no key to copy.",
      ],
      note: "Claude Code and other terminal tools: run /mcp to see whether the connector is already there. If not, the optional command below adds it.",
      snippet: { label: "Claude Code (optional)", code: `claude mcp add --transport http product-velocity ${url}` },
    },
    {
      assistant: "chatgpt",
      title: "ChatGPT",
      steps: [
        "Copy the connector URL.",
        "In ChatGPT open Settings, then Apps and Connectors, turn on Developer mode under Advanced settings, choose Create, name it Product Velocity, paste the URL and choose OAuth. On Business, Enterprise and Edu plans a ChatGPT workspace admin must allow custom connectors first.",
        "Choose Connect, sign in, pick one or several workspaces and approve. In a new chat add Product Velocity from the + menu.",
      ],
      note: "ChatGPT cannot start prompts, so say \"use the write_prd playbook\" or simply describe what you want; the assistant reads the same instructions through the get_playbook tool. Deep research and company knowledge use the search and fetch tools, which are read-only.",
    },
    {
      assistant: "gemini",
      title: "Gemini (Gemini app, Gemini CLI)",
      steps: [
        "Copy the connector URL.",
        "In Gemini open Connected Apps, choose Custom, pick Cloud MCP (a remotely hosted server via URL), paste the URL and choose Next.",
        "Sign in, pick one or several workspaces and approve.",
      ],
      note: "Gemini shows a warning that custom apps are not reviewed by Google; that is expected. Terminal users can instead run the optional command below, then /mcp auth product-velocity in Gemini CLI.",
      snippet: {
        label: "Gemini CLI (optional)",
        code: `gemini mcp add --transport http product-velocity ${url}`,
      },
    },
  ];
}

/** Added to the always-on instructions: how a client reaches the flows. A client that cannot start MCP prompts (ChatGPT) gets the same text through get_playbook. */
export function playbookInstructions(clientStartsPrompts: boolean): string {
  return clientStartsPrompts
    ? "The prompts write_prd, write_discovery and research_company start the PRD, discovery and company-profile flows."
    : "This client cannot start prompts: when the person asks for one of the flows write_prd, write_discovery or research_company, call get_playbook with its name and follow the text it returns.";
}
