/** True when this email is the shared read-only demo account (issue #559). Compared on the server only; the address itself is never sent to the browser. */
export function isDemoEmail(email: string | null | undefined): boolean {
  const demo = process.env.DEMO_VIEWER_EMAIL?.trim().toLowerCase();
  return !!demo && !!email && email.trim().toLowerCase() === demo;
}
