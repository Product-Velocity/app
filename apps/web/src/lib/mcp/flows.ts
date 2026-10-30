/**
 * The flows a person can start from any assistant (docs/27-AI-ASSISTANTS-AND-MEMORY.md section 7). One list serves two doors: MCP prompts
 * (prompts/list and prompts/get, for clients that can start them: Claude, Gemini CLI) and the get_playbook tool (for clients that cannot: ChatGPT).
 * The text is the same either way. A flow carries no data of its own and runs no tool.
 */
import { discoveryPrompt, prdPrompt, researchPrompt, reviewGroupPrompt, setupMemoryPrompt } from "@pv/domain";
import type { McpBackend } from "./rpc";

export type FlowArg = { name: string; description: string; required: false };
export type Flow = {
  name: string;
  title: string;
  description: string;
  arguments: FlowArg[];
  /** The text for this flow. Arguments are the person's words: data, cut to size. */
  build: (args: Record<string, unknown>, backend: McpBackend) => Promise<{ description: string; text: string }>;
};

const text = (v: unknown, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const arg = (name: string, description: string): FlowArg => ({ name, description, required: false });

export const FLOWS: Flow[] = [
  {
    name: "write_prd",
    title: "Write a PRD and create the initiative",
    description: "Write a PRD in your usual format, create the initiative with every field the brief supports, and keep the full PRD as a document that never reaches GitHub. Asks once for what is missing; skipping is always allowed.",
    arguments: [
      arg("brief", "What the initiative is, in your own words (optional; the assistant asks if empty)."),
      arg("modules", "Optional appendix modules to include, by id, e.g. A1, D1, D4 (default: the assistant chooses and tells you)."),
      arg("item", "Optional existing initiative code, e.g. R-12, to update instead of creating a new one."),
    ],
    build: async (a) => prdPrompt({ brief: text(a.brief), modules: text(a.modules), item: text(a.item) }),
  },
  {
    name: "write_discovery",
    title: "Write a discovery document and register its initiative",
    description: "Write a discovery (objective and key results, problem, evidence, risks, potential solutions, next steps, test plan) as a document that never reaches GitHub, and create the one initiative that holds it. Asks once for what is missing; placeholders stay \"to define\"; skipping is always allowed.",
    arguments: [
      arg("brief", "What the discovery is about, in your own words (optional; the assistant asks if empty)."),
      arg("item", "Optional existing initiative code, e.g. R-12, to attach the discovery to instead of creating a new initiative."),
    ],
    build: async (a) => discoveryPrompt({ brief: text(a.brief), item: text(a.item) }),
  },
  {
    name: "review_group",
    title: "Review the other initiatives in the same group",
    description: "Compare an initiative, or an idea that is not an initiative yet, with the other initiatives of its Initiative Group: what overlaps, what depends on what, which dates or terms conflict, what is missing. Reads only; changes nothing unless you say so.",
    arguments: [
      arg("item", "An initiative code, e.g. R-12 (its Initiative Group is used)."),
      arg("group", "An Initiative Group name, when you have no initiative yet."),
      arg("brief", "Optional: the idea to compare with the group, in your own words."),
    ],
    build: async (a) => reviewGroupPrompt({ item: text(a.item, 40), group: text(a.group, 200), brief: text(a.brief) }),
  },
  {
    name: "research_company",
    title: "Research the company and save its profile",
    description: "Read the company's public website, draft its profile (industry, position, products, personas, competitors, glossary, voice) with sources, show it to you, and save it as an AI draft that a workspace admin confirms. Later PRDs and discoveries use it. Asks once for what the web cannot tell.",
    arguments: [
      arg("url", "The company website (optional; the workspace's company website is used when it is set)."),
      arg("focus", "Optional: what to look at most closely."),
    ],
    build: async (a, backend) => {
      const company = await backend.read.companyProfile().catch(() => null);
      return researchPrompt({ url: text(a.url, 300), company_url: company?.url ?? null, focus: text(a.focus, 2000) });
    },
  },
  {
    name: "setup_memory",
    title: "Set up the memory from what the workspace already knows",
    description: "Collect the durable knowledge already written in the company profile and the largest groups' documents (terms, partners, preferences, lessons), let you choose what to keep, and save it as notes every assistant can recall later.",
    arguments: [arg("focus", "Optional: a group or topic to start with.")],
    build: async (a) => setupMemoryPrompt({ focus: text(a.focus, 2000) }),
  },
];

export const FLOW_NAMES = FLOWS.map((f) => f.name);
export const publicFlow = (f: Flow) => ({ name: f.name, title: f.title, description: f.description, arguments: f.arguments });
