---
name: product-velocity-discovery
description: Guided workflow to explore customer opportunities, assemble multi-source evidence, evaluate solution candidates, and submit a Discovery document for Gate A approval in Product Velocity via MCP.
---

# Product Velocity — Write Discovery Skill

This skill guides Gemini to conduct an opportunity discovery, structure evidence across sources, evaluate competing solution candidates, and submit a Discovery document to Product Velocity using the `product-velocity` MCP server.

---

## 1. Core Principles & Guardrails (Non-Negotiable)

1. **Step Before the PRD:** A Discovery document explores an opportunity and compares candidate solutions *before* committing to a specific PRD. It targets Decision Gate A (Discover to Define).
2. **Never Guess:** Numbers, baselines, percentages, quotes, and links must come directly from the user or from sources you read. Any placeholder in the brief ("X%", "xx") remains `"to define"`.
3. **Skip is Always Free:** Every section is optional. A discovery with missing sections simply omits them. "Skip" is a valid answer.
4. **Team, Not Owner (`TEAM_RULE`):** Documents are authored by a team (`Product Manager = ?, Designer = ?, Engineering Manager = ?`). Never attribute ownership to the signed-in user account alone.
5. **Only One Initiative is Registered:** The document belongs to ONE initiative in phase `"Discover"` (named `"Discovery: <topic>"` or the name of the chosen solution if already selected). Do not create separate initiatives for each candidate solution.
6. **Commercial Privacy:** Discovery documents carry sensitive commercial metrics, customer evidence, and competitor evaluations. They are stored in `item_documents` and **never sync to GitHub or Jira**.
7. **Gemini Never Approves:** Gate A approval is granted by a person with Approver rights in Product Velocity. Gemini cannot approve or advance gates.

---

## 2. Step-by-Step Workflow

### Step 1: Pre-Flight & Prior Knowledge
1. Call `get_workspace_context` to verify:
   - Active workspace, projects, Initiative Groups, and user role.
2. Check workspace knowledge:
   - Search for related initiatives (`search_items`) in the same Initiative Group or Focus Area.
   - Call `list_documents` and `get_document` on relevant initiatives to reuse established terminology, personas, and known risks.
   - Call `get_company_profile` to retrieve the company's glossary and overarching OKRs.

---

### Step 2: Assemble the Discovery Document Structure
Use the standardized markdown headings:

```markdown
# Discovery: [Topic / Opportunity]

### Team
| Role | Name |
|---|---|
| Product Manager | [Name or "to define"] |
| Product Designer | [Name or "to define"] |
| Engineering Manager | [Name or "to define"] |
| [Other Role] | [Name] |

## 1. Objective and key results
- **Company OKR:** [ID and OKR statement]
- **Discovery Objective:** [What this discovery seeks to prove or solve]

### Key Results
| Metric | Unit | Direction | Baseline | Target | Type | Source / Notes |
|---|---|---|---|---|---|---|
| [Metric 1] | % | Increase | [Baseline] | [Target] | Primary | [Source] |
| [Metric 2] | Days | Decrease | [Baseline] | [Target] | Guardrail | [Source] |

## 2. Problem / opportunity
[Who experiences the problem, what triggers it, and the commercial/user impact]

## 3. Why (Evidence)
- **Internal Data:** [Metrics, churn data, support ticket volumes with links or "reported by"]
- **Customer Insights:** [Direct quotes or user research findings]
- **Third-Party & Industry Research:** [External market reports or benchmarks]
- **Competitive Insights:** [What comparable products offer]

## 4. Risks
[Key adoption, technical, organizational, or regulatory risks and proposed mitigations]

## 5. Potential solutions
| # | Solution & Hypothesis | Pillar | MoSCoW | Est. Impact | Confidence | Effort | Risks | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | IF [X] THEN [Y] RESULTING IN [Z] | Growth | Must | High | Medium | 4 wks | ... | Proposed |
| 2 | IF [A] THEN [B] RESULTING IN [C] | Platform| Should | Medium | Low | 6 wks | ... | Proposed |

*Note: Solutions drafted by Gemini are marked "Proposed by Gemini" until accepted by the team.*

## 6. Next steps (Gate A Preparation)
- Present candidate solutions at Gate A review.
- Align stakeholders on the single chosen solution.
- Transition chosen solution to Initiative Phase "Define" and initiate the PRD flow.

## 7. Testing success
[How the chosen solution will be tested: AB(C) testing plan, metrics, and guardrails]

## 8. Context and partner research
[Relevant third-party platforms, APIs, or vendor capabilities examined]
```

---

### Step 3: The Single Grouped Question Batch

Analyze the user's initial prompt and ask **ONE single, grouped message** for missing details:

> **To complete your Discovery document, please provide the details below (you can reply "skip" to any question):**
> 
> 1. **Align or Save?** Would you like to review and discuss the discovery draft here first, or save it as an AI draft to Product Velocity now?
> 2. **Team:** Who is on this team? (`Product Manager = ?`, `Designer = ?`, `Engineering Manager = ?`)
> 3. **Company OKR & Objective:** Which company OKR does this support, and what is the primary key result baseline/target?
> 4. **Evidence Sources:** What data or customer feedback supports this? (If fewer than 2 sources exist, suggest checking support tickets, analytics, or user interviews; otherwise label as *Light Evidence*).
> 5. **Candidate Solutions:** Do you already have specific solution options in mind, or would you like me to propose 2–3 options based on the problem statement?
> 6. **Chosen Solution (if decided):** Has a preferred solution already been chosen to advance to Gate A?

---

### Step 4: Dry Run & Preview
1. If the user chose to align: present the draft in the conversation and refine the solutions table and evidence together.
2. If the user wants to save:
   - Run `create_items` with `dry_run: true` to prepare the discovery initiative:
     - `initiative_name`: `"Discovery: <Topic>"` (or chosen solution name)
     - `initiative_phase`: `"Discover"`
     - `project`: Target project ID
   - Show the dry-run summary for user confirmation.

---

### Step 5: Submission to Product Velocity via MCP
Once confirmed by the user:
1. **Create the Discovery Initiative:**
   - Call `create_items` (or `update_items` if linking to an existing discovery item). Note the returned `item_id`.
2. **Save the Discovery Document:**
   - Call `create_document`:
     ```json
     {
       "item_id": "<item_id>",
       "title": "Discovery: <Topic>",
       "kind": "discovery",
       "body": "<Full markdown text>",
       "ai_model": "gemini-1.5-pro"
     }
     ```
3. **Closing Summary & Gate A Readiness:**
   - Provide the user with the direct link to the initiative in Product Velocity (`/portfolio?item=<item_code>&tab=spec`).
   - Remind the user:
     > *"This discovery document is saved as an AI draft. To proceed, review the solutions with your team and present it for Gate A (Discover → Define) approval. Once approved, you can launch the `/write-prd` skill on the chosen solution."*
