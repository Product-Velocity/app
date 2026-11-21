import { BrandLogo } from "@/components/brand-logo";

/**
 * Words on the brand side of the sign-in, create-account, invitation and
 * password-reset screens. The same wording as the homepage hero (issue #498):
 * change them together. No claims beyond the brand guide, no "Claude approves".
 */
export const AUTH_BRAND = {
  eyebrow: "One source of truth for product managers and their AI",
  tagline: "AI changed the PM's job. Give it one place to work from.",
  what: "Product Velocity is the single source of truth where product managers, stakeholders and their AI plan, decide and deliver together. Every initiative in one place, from the company objective to the delivery ticket, on top of Jira and GitHub.",
  why: "Product teams move faster, every stakeholder stays informed, and bigger outcomes get delivered.",
  pillars: [
    { name: "Clarity", line: "One roadmap for every team and business line, from idea to completed roll-out." },
    { name: "Transparency", line: "What, why, who and when, from leadership and stakeholder reports to Jira tickets." },
    { name: "Alignment", line: "Stakeholders rank and vote, and plans fit capacity." },
    { name: "Impact", line: "Objectives and key results tracked on every initiative." },
  ],
} as const;

/** Split screen: brand message on one side, the form on the other. Stacks on a phone. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-split">
      <aside className="auth-brand" aria-label="About Product Velocity">
        <BrandLogo size={56} />
        <div className="auth-brand-main">
          <p className="auth-eyebrow">{AUTH_BRAND.eyebrow}</p>
          <p className="auth-tag">{AUTH_BRAND.tagline}</p>
          <p className="auth-what">{AUTH_BRAND.what}</p>
          <p className="auth-why">{AUTH_BRAND.why}</p>
        </div>
        <dl className="auth-pillars">
          {AUTH_BRAND.pillars.map((p) => (
            <div key={p.name}>
              <dt>{p.name}</dt>
              <dd>{p.line}</dd>
            </div>
          ))}
        </dl>
      </aside>
      <div className="auth-main">
        <div className="auth-form">{children}</div>
      </div>
    </main>
  );
}
