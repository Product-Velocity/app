import { BrandLogo } from "@/components/brand-logo";

/**
 * Words on the brand side of the sign-in, create-account, invitation and
 * password-reset screens. The same wording as the homepage hero (issue #498):
 * change them together. No claims beyond the brand guide, no "Claude approves".
 */
export const AUTH_BRAND = {
  eyebrow: "Agentic product management platform",
  tagline: "Deliver bigger, better outcomes. Faster.",
  what: "As engineering speeds up with agents, the bottleneck moves to what to build and how fast you can decide. Product Velocity gives product managers and their AI co-workers one roadmap with the context, the place for the work and the path from strategy to tracked outcome, across business lines, PM scopes and teams. AI prepares, people decide.",
  why: "One roadmap for humans and their AI, from company OKR to tracked outcome.",
  pillars: [
    { name: "Context", line: "The roadmap is the shared memory every AI agent starts from." },
    { name: "Alignment", line: "Research, prioritisation and delivery on one roadmap and one stack rank, with plans that fit capacity." },
    { name: "Velocity", line: "See where the time goes, per team and per phase." },
    { name: "Outcomes", line: "Objectives and key results tracked on every initiative." },
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
