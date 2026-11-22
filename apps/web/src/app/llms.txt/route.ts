import { CONNECTOR_URL, SITE_URL } from "@/lib/public-contact";
import { HOME_DESCRIPTION } from "../(marketing)/seo";

/** A plain-text summary for AI assistants and crawlers (the llms.txt convention). Same facts as the homepage; nothing the product does not do today. */
export function GET() {
  const text = `# Product Velocity

> ${HOME_DESCRIPTION}

Product Velocity is an agentic product management platform for product managers who own both the quality of the outcome and the speed of getting there. As engineering speeds up with agents, the bottleneck moves to what to build and how fast you can decide; Product Velocity keeps strategy, roadmap and delivery on one roadmap. It is one roadmap for humans and their AI co-workers, from company OKRs to tracked outcomes, across business lines, PM scopes and teams. The roadmap is the shared memory every AI agent (Claude, ChatGPT, Gemini) starts from, so agents work from the same current context. AI prepares the work, people decide. It was built by a group of product leaders, from product people for product people. It does not replace Jira or GitHub: it hosts the layer around delivery (company objectives and OKRs, go-to-market, outcomes and time to market) and connects to the delivery tools.

## What it does
- One roadmap for every team and business line, with one stack rank and a capacity fit line per team.
- Line-item first: every initiative sits under a company objective and carries its key results.
- Views and reports for each audience (leadership, teams, delivery) from the same data.
- Alignment: stakeholders rank and vote (top 5 with duels, 100 coins or ICE scoring). Results are anonymous and small groups are kept private.
- A lifecycle of seven phases (Discover, Define, Build, Test, Experiment, Roll-out, Completed) with three decision gates. A person decides at every gate and the reason is kept.
- Two-way sync with Jira and GitHub for delivery progress. Commercial data (value, customers, decisions, key results, outcomes) never goes to the delivery tools.
- Velocity and reporting: time in each phase and initiatives by team and phase (team level only, never individuals), needs-action flags, and reports for leadership, teams and delivery built from the same roadmap data.
- One funnel: goals, customer requests and ideas land on the roadmap, are ranked with a capacity fit line, a person decides at the gates, delivery runs in Jira and GitHub, and the outcome reviews feed the next plan.
- Outcomes and adoption are tracked after launch, at 30, 60 and 90 days.
- The loop: decide (AI helps shape the opportunity and business case, people decide at the gates), deliver (epics and stories go to Jira and GitHub; progress flows back), learn (your AI analyses the results and brings them back, next to the initiative, its effort and key result; people review them).
- Bring your own AI: it works with AI assistants such as Claude through a connector. AI prepares work and marks it as a draft; people decide. We do not sell tokens.

## Pages
- [Home](${SITE_URL}/): what Product Velocity is and how to join us
- [Home as plain text](${SITE_URL}/llms-full.txt): the homepage sections as plain text, for AI assistants
- [Connect Claude](${SITE_URL}/connector): how the Claude connector works, what Claude can and cannot do, permissions and data handling
- [Privacy policy](${SITE_URL}/privacy): how data is handled
- [Contact](${SITE_URL}/contact): a form for questions, privacy requests and joining us

## Connect
- Claude connector directory: https://claude.ai/directory/connectors/product-velocity
- Connector address (MCP): ${CONNECTOR_URL}

## Contact
Use the form at ${SITE_URL}/contact.

## Status
Product Velocity is built by a group of product leaders for their own daily work, not as a business model. Joining is by request on the homepage.
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
