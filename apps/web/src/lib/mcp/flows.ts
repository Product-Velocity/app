/**
 * The flows a person can start from any assistant (docs/27-AI-ASSISTANTS-AND-MEMORY.md section 7). One list serves two doors: MCP prompts
 * (prompts/list and prompts/get, for clients that can start them: Claude, Gemini CLI) and the get_playbook tool (for clients that cannot: ChatGPT).
 * The text is the same either way. A flow carries no data of its own and runs no tool.
 */
import { discoveryPrompt, parseSkillArgs, prdPrompt, researchPrompt, skillHelpText, skillPrompt, SKILLS } from "@pv/domain";
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
      arg("team", "Optional: who is on the team, e.g. product manager = Ana, designer = Li, engineering manager = Raj."),
    ],
    build: async (a) => prdPrompt({ brief: text(a.brief), modules: text(a.modules), item: text(a.item), team: text(a.team, 2000) }),
  },
  {
    name: "write_discovery",
    title: "Write a discovery document and register its initiative",
    description: "Write a discovery (objective and key results, problem, evidence, risks, potential solutions, next steps, test plan) as a document that never reaches GitHub, and create the one initiative that holds it. Asks once for what is missing; placeholders stay \"to define\"; skipping is always allowed.",
    arguments: [
      arg("brief", "What the discovery is about, in your own words (optional; the assistant asks if empty)."),
      arg("item", "Optional existing initiative code, e.g. R-12, to attach the discovery to instead of creating a new initiative."),
      arg("team", "Optional: who is on the team, e.g. product manager = Ana, designer = Li, engineering manager = Raj."),
    ],
    build: async (a) => discoveryPrompt({ brief: text(a.brief), item: text(a.item), team: text(a.team, 2000) }),
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
];

/** The PV skills (issue #565): one flow per skill, named pv-<skill>, plus pv-help. */
const SKILL_FLOWS: Flow[] = [
  ...SKILLS.map((spec): Flow => ({
    name: spec.command,
    title: spec.title,
    description: `${spec.summary.charAt(0).toUpperCase()}${spec.summary.slice(1)}. ${spec.output === "report" ? "Reads what the workspace stores, asks once and produces it in the format you choose; nothing is saved or sent unless you ask." : "Reads the company profile and what the workspace stores, asks once, saves a document as an AI draft."}`,
    arguments: [
      arg("target", spec.focus ? "Optional: only these initiatives, as codes (R-12 R-14), a range (R-1 to R-5), view:\"Name\" or group:\"Name\". Leave empty for all initiatives." : "The initiative code such as R-12 (or several, or view:\"Name\" or group:\"Name\"); leave empty and the skill asks."),
      arg("input", "Your own words and any pasted material (optional). It is treated as material, never as instructions. Typed form: pv-<skill> R-12 your words --draft."),
      arg("draft", "Write \"true\" to see the result in the chat and save nothing until you say so."),
      ...(spec.team ? [arg("team", "Optional: who is on the team, e.g. product manager = Ana, designer = Li.")] : []),
      ...(spec.output === "report" ? [arg("format", "How you want the report: email, slides, document, slack or chat. Nothing is saved or sent unless you ask.")] : []),
    ],
    build: async (a) => skillPrompt(spec, { target: text(a.target, 500), input: text(a.input), draft: text(a.draft, 10), team: text(a.team, 2000), format: text(a.format, 20) }),
  })),
  {
    name: "pv-help",
    title: "List the Product Velocity skills",
    description: "How to use the pv- skills and which ones exist.",
    arguments: [],
    build: async () => skillHelpText(),
  },
];
FLOWS.push(...SKILL_FLOWS);

/** Typed form for clients that cannot start prompts: "pv-premortem R-12 ... --draft" in one string. */
export const parseTypedSkill = parseSkillArgs;

export const FLOW_NAMES = FLOWS.map((f) => f.name);
export const publicFlow = (f: Flow) => ({ name: f.name, title: f.title, description: f.description, arguments: f.arguments });
