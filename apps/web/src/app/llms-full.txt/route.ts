import { SITE_URL } from "@/lib/public-contact";
import { sectionText, useCaseText } from "../(marketing)/plain-text";
import { HOME_DESCRIPTION } from "../(marketing)/seo";
import { PV2_CHANGES, PV2_HOW, PV2_PROBLEM, PV2_TRUST, PV2_UC_HEAD, PV2_UC_PANELS, PV2_VELOCITY, PV2_WHAT } from "../(marketing)/art-v2";

export function GET() {
  const body = [sectionText(PV2_PROBLEM), sectionText(PV2_WHAT), sectionText(PV2_HOW), useCaseText(PV2_UC_HEAD, PV2_UC_PANELS), sectionText(PV2_VELOCITY), sectionText(PV2_CHANGES), sectionText(PV2_TRUST)].join("\n\n");
  const text = `# Product Velocity: agentic product management platform

> ${HOME_DESCRIPTION}

Source: ${SITE_URL}/ (the homepage). A shorter summary is at ${SITE_URL}/llms.txt. Product pictures on the page use example data from a fictional company (Meridian Media).

${body}

## Join us
Product Velocity is built by a group of product leaders for their own daily work, not as a business model. Joining is by request on the homepage: ${SITE_URL}/#early-access
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
