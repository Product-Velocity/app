import { BrandLogo } from "@/components/brand-logo";

/**
 * Words on the brand side of the sign-in, create-account, invitation and
 * password-reset screens. Taken from the brand guide (README, "Who we are");
 * change them there first. No claims beyond the guide, no "Claude approves".
 */
export const AUTH_BRAND = {
  tagline: "One roadmap for humans and AI.",
  what: "The AI-first product management platform that follows every initiative from idea through launch and measured outcomes.",
  why: "So people and AI have the context to deliver fast.",
  pillars: [
    { name: "Clarity", line: "One roadmap and one stack rank." },
    { name: "Alignment", line: "Agreed on why, what, how and when." },
    { name: "Velocity", line: "Work moves across the whole lifecycle." },
    { name: "Impact", line: "Outcomes measured after launch." },
  ],
} as const;

/** Split screen: brand message on one side, the form on the other. Stacks on a phone. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-split">
      <aside className="auth-brand" aria-label="About Product Velocity">
        <BrandLogo size={40} />
        <div className="auth-brand-main">
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
