// "Copy to other projects" under the Field mapping table (decision 2026-11-16-tracker-settings-sections): the same saved settings written to the projects
// ticked here. A plain form post. The same box on GitHub and Jira; the action decides what can be copied (Jira: projects on the same site).
export function CopyMapping({ tracker, fromId, fromName, others, action }: { tracker: "GitHub" | "Jira"; fromId: string; fromName: string; others: { id: string; name: string }[]; action: (formData: FormData) => void | Promise<void> }) {
  return (
    <details className="stack">
      <summary>Copy these settings to other projects</summary>
      <form action={action} className="stack" aria-label={`Copy the field settings of ${fromName}`}>
        <input type="hidden" name="from" value={fromId} />
        <p className="muted">Copies the settings <strong>saved</strong> for {fromName} (save first if you just changed something) to the projects you tick. If {fromName} has none saved, the others go back to the defaults. {tracker === "GitHub" ? "The linked board fields (Project boards) are not copied." : "Only projects on the same Jira site are changed: field ids differ between sites."}</p>
        <fieldset className="stack">
          <legend>Copy to</legend>
          {others.map((p) => <label key={p.id}><input type="checkbox" name="to" value={p.id} /> {p.name}</label>)}
        </fieldset>
        <div><button className="btn" type="submit">Copy saved settings</button></div>
      </form>
    </details>
  );
}
