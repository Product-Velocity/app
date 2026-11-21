/** Always visible for the shared, read-only demo account (issue #559). */
export function DemoBanner() {
  return (
    <div className="platform-banner platform-banner-ro" role="status" data-testid="demo-banner">
      <span>
        You&rsquo;re viewing a <strong>read-only demo</strong> of Product Velocity with example data. Nothing you click here is saved.
      </span>
      <form action="/auth/sign-out" method="post">
        <input type="hidden" name="next" value="/" />
        <button className="btn" type="submit">Exit demo &amp; sign up</button>
      </form>
    </div>
  );
}
