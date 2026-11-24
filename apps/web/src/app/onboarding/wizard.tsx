import { INVITED_STEPS, WIZARD_STEPS, type WizardStep } from "@/lib/onboarding";

/** The frame of every onboarding screen: a progress list (text labels, never colour alone) and the card. */
export function Wizard({ step, title, intro, children }: { step: WizardStep; title: string; intro: string; children: React.ReactNode }) {
  const steps: readonly { key: string; label: string }[] = step === "invited-welcome" ? INVITED_STEPS : WIZARD_STEPS;
  const at = steps.findIndex((s) => s.key === step);
  return (
    <main className="auth-page">
      <div className="card wizard-card">
        <nav aria-label="Setup progress">
          <ol className="wizard-steps">
            {steps.map((s, i) => (
              <li key={s.key} className={i < at ? "is-done" : i === at ? "is-now" : ""} aria-current={i === at ? "step" : undefined}>
                <span className="wizard-dot" aria-hidden="true">{i < at ? "✓" : i + 1}</span>
                <span>{s.label}<span className="sr-only">{i < at ? " (done)" : i === at ? " (current step)" : ""}</span></span>
              </li>
            ))}
          </ol>
        </nav>
        <h1>{title}</h1>
        <p className="muted wizard-intro">{intro}</p>
        {children}
      </div>
    </main>
  );
}
