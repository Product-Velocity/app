import { HelpPage, HelpSection } from "@/components/help/help-ui";
import { SHORTCUT_SECTIONS } from "@/components/help/shortcuts-data";

export const metadata = {
  title: "Keyboard shortcuts · Help · Product Velocity",
  description: "Keyboard shortcuts and the one-line quick add words for Product Velocity.",
};

export default function ShortcutsHelp() {
  return (
    <HelpPage current="shortcuts" title="Keyboard shortcuts" intro="Product Velocity is built for the keyboard. On a Mac use ⌘ where it says Ctrl. Press Ctrl+K in the app to open the command palette.">
      {SHORTCUT_SECTIONS.map((s, i) => (
        <HelpSection key={s.title} id={`s${i}`} title={s.title}>
          <dl className="help-list">
            {s.rows.map(([k, v]) => (<div key={k + v}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>))}
          </dl>
        </HelpSection>
      ))}
    </HelpPage>
  );
}
