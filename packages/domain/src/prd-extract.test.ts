import { describe, expect, it } from "vitest";
import { buildExtract, DESCRIPTION_LIMIT } from "./prd-extract";

const PRD = `# PRD: Account switcher

> **Depends on R-110.** Do not start until it is live.

## 1. Executive Summary (TL;DR)
Switch accounts in one click.

**At a glance**
- What we will build: a switcher
- What we will not build: parent organizations

## 2. Relationship to R-110
SECRET_REL

## 3. Problem Statement
People with several companies need several logins.

### Hypothesis
IF we add a switcher
THEN consultants stay signed in
RESULTING IN fewer support requests

## 4. Scope
### 4.1 In scope
- the switcher

## 5. Prerequisites
Migrate users first.

## 6. Functional Requirements
| ID | Requirement |
| FR-1 | breadcrumb |

## 7. Acceptance Criteria
1. Works.

## 8. Risks and open questions
SECRET_RISK

## 9. Suggested phasing
Phase 0, then Phase 1.

## A1 Company Value Story
SECRET_STORY: this grows revenue by 2M EUR.

### Customer value proposition (customer-safe)
Sign in once and move between your companies in a click.

## D1 Rollout Plan
SECRET_THRESHOLD: stop if conversion < 3%.

## B1 UX Flows
https://figma.example/flow

## Z9 Something else
SECRET_UNKNOWN
`;

describe("buildExtract", () => {
  const e = buildExtract(PRD, 3);

  it("copies only the GitHub-safe sections, labelled with the PRD version", () => {
    expect(e.included).toEqual(["1", "3", "4", "5", "6", "7", "9"]);
    expect(e.description).toMatch(/^_From PRD v3\./);
    for (const secret of ["SECRET_REL", "SECRET_RISK", "SECRET_STORY", "SECRET_THRESHOLD", "SECRET_UNKNOWN", "figma.example", "Depends on R-110", "2M EUR"]) expect(e.description, secret).not.toContain(secret);
    expect(e.description).toContain("What we will not build: parent organizations");
    expect(e.description).toContain("FR-1");
  });

  it("puts the headings one level down so they nest under the Description section", () => {
    expect(e.description).toContain("### 1. Executive Summary (TL;DR)");
    expect(e.description).toContain("#### Hypothesis");
    expect(e.description).not.toMatch(/^## /m);
  });

  it("says why each other section was left out", () => {
    const byId = Object.fromEntries(e.left_out.map((l) => [l.id, l.reason]));
    expect(byId["2"]).toMatch(/never goes to GitHub/);
    expect(byId["8"]).toMatch(/never goes to GitHub/);
    expect(byId["A1"]).toMatch(/never goes to GitHub/);
    expect(byId["D1"]).toMatch(/never goes to GitHub/);
    expect(byId["B1"]).toMatch(/links only/);
    expect(byId["Z9"]).toMatch(/not a section of the template/);
  });

  it("finds the hypothesis and the customer-safe value proposition as written", () => {
    expect(e.hypothesis).toBe("IF we add a switcher\nTHEN consultants stay signed in\nRESULTING IN fewer support requests");
    expect(e.value_proposition).toBe("Sign in once and move between your companies in a click.");
    expect(e.warnings).toEqual([]);
  });

  it("reads bold and bulleted hypothesis lines and a bold value-proposition label", () => {
    const x = buildExtract("## 3. Problem\n- **IF:** a\n- **THEN:** b\n- **RESULTING IN:** c\n\n**Customer value proposition:**\nOne login.\n\n**Other:**\nx\n", 1);
    expect(x.hypothesis).toBe("**IF:** a\n**THEN:** b\n**RESULTING IN:** c");
    expect(x.value_proposition).toBe("One login.");
  });

  it("does not copy a value proposition that holds a money amount, and says so", () => {
    for (const money of ["Save €2,000 a year.", "Worth 50k EUR.", "Only $19 per seat."]) {
      const x = buildExtract(`## A1 Story\n### Customer value proposition\n${money}\n`, 1);
      expect(x.value_proposition, money).toBeNull();
      expect(x.warnings.join(" "), money).toMatch(/money amount/);
    }
    expect(buildExtract("## A1 Story\n### Customer value proposition\nSave time on every login. 24/7.\n", 1).value_proposition).toBe("Save time on every login. 24/7.");
  });

  it("reports what is missing instead of inventing it", () => {
    const x = buildExtract("## 4. Scope\nSmall.\n", 1);
    expect(x.hypothesis).toBeNull();
    expect(x.value_proposition).toBeNull();
    expect(x.warnings.join(" ")).toMatch(/No Hypothesis block/);
    expect(x.warnings.join(" ")).toMatch(/No customer value proposition/);
    const none = buildExtract("# Just a title\nsome text\n", 1);
    expect(none.description).toBeNull();
    expect(none.warnings.join(" ")).toMatch(/No GitHub-safe section/);
  });

  it("ignores headings inside code fences and accepts the Appendix wording", () => {
    const x = buildExtract("## 4. Scope\n```\n## 8. Risks\nSECRET\n```\nafter\n\n## Appendix D1: Rollout\nSECRET2\n", 1);
    expect(x.included).toEqual(["4"]);
    expect(x.description).toContain("SECRET"); // inside the safe section's own fence, kept as written
    expect(x.description).not.toContain("SECRET2");
    expect(x.left_out.map((l) => l.id)).toEqual(["D1"]);
  });

  it("refuses to copy a Description over the limit and tells which sections are big", () => {
    const big = buildExtract(`## 6. Functional Requirements\n${"x".repeat(DESCRIPTION_LIMIT)}\n`, 1);
    expect(big.description).toBeNull();
    expect(big.warnings.join(" ")).toMatch(/at most 20,000/);
  });

  it("is not fooled by another PRD-only section placed between safe ones", () => {
    const x = buildExtract("## 3. Problem\nA\n## 8. Risks\nSECRET_MID\n## 9. Phasing\nB\n", 1);
    expect(x.description).not.toContain("SECRET_MID");
    expect(x.included).toEqual(["3", "9"]);
  });
});
