import { AGENT_GUIDES, AGENT_INTRO } from "@/components/help-content";
import { ConnectorUrlBox } from "@/components/help/connector-url-box";
import { HelpList, HelpPage, HelpSection, HelpTable } from "@/components/help/help-ui";
import { CONNECTOR_URL } from "@/lib/public-contact";

export const metadata = {
  title: "Connect an AI assistant · Help · Product Velocity",
  description: "Step by step setup for Claude, ChatGPT and Gemini, what to say first, and how to revoke a connection.",
};

const PLACEHOLDER = "the connector URL shown under Connect an AI assistant";
/** Turns a web address in a step into a link, so the directory page is one click away. */
function withLinks(text: string) {
  return text.split(/(https:\/\/[^\s,)]+[^\s,.)])/).map((part, i) => (i % 2 === 1 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part));
}

const ORDER = ["claude", "chatgpt", "gemini"] as const;
const NAME = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" } as const;

export default function AiSetupHelp() {
  return (
    <HelpPage
      current="ai-setup"
      title="Connect an AI assistant"
      intro={AGENT_INTRO}
      toc={ORDER.map((k) => ({ id: k, label: NAME[k] }))}
    >
      <p>Use this address in any assistant that supports connectors:</p>
      <ConnectorUrlBox url={CONNECTOR_URL} />
      {ORDER.map((k) => {
        const g = AGENT_GUIDES[k];
        return (
          <HelpSection key={k} id={k} title={g.title}>
            <h3>Set up</h3>
            <ol className="hp-steps">{g.setup.map((s) => <li key={s}>{withLinks(s.replaceAll(PLACEHOLDER, CONNECTOR_URL))}</li>)}</ol>
            {g.snippet && (
              <details className="help-details">
                <summary>Advanced: command line and settings file</summary>
                <pre className="code-block">{g.snippet.replaceAll(PLACEHOLDER, CONNECTOR_URL)}</pre>
              </details>
            )}
            <h3>Onboarding</h3>
            <ol className="hp-steps">{g.onboarding.map((s) => <li key={s}>{s}</li>)}</ol>
            <HelpTable caption={`Features and commands in ${NAME[k]}`} table={g.features} />
            <HelpList items={g.notes} />
          </HelpSection>
        );
      })}
    </HelpPage>
  );
}
