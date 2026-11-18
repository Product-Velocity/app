/** Help in the top bar: opens the Help pages in a new browser tab, so the roadmap you are working on stays where it is. */
export function HelpLink() {
  return (
    <a className="bar-icon-btn" href="/help" target="_blank" rel="noopener" aria-label="Help (opens in a new tab)" title="Help: goals, lifecycle, alignment, reports, delivery platforms and AI (opens in a new tab)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
        <path d="M12 16.8h.01" />
      </svg>
    </a>
  );
}
