/** The seven phases in three acts, with the three decision gates where the decision happens (Ashu's Lifecycle and Gates artifact, 2026-11). */
const PHASES = [
  { n: "01", name: "Discover", note: "Find a problem worth solving", act: "Decide" },
  { n: "02", name: "Define", note: "Shape the answer", act: "Decide" },
  { n: "03", name: "Build", note: "Make it", act: "Deliver" },
  { n: "04", name: "Test", note: "Does it work?", act: "Deliver" },
  { n: "05", name: "Experiment", note: "Does it move the number?", act: "Learn" },
  { n: "06", name: "Roll-out", note: "Go to market", act: "Learn" },
  { n: "07", name: "Completed", note: "Measure the outcome, then learn", act: "Learn" },
] as const;
// a gate sits after the phase at this index
const GATES: Record<number, { id: string; question: string }> = {
  0: { id: "A", question: "Worth defining?" },
  1: { id: "B", question: "Commit to build?" },
  4: { id: "C", question: "May it roll out?" },
};

export function LifecycleFlow() {
  return (
    <figure className="hp-flow" aria-label="The seven phases and the three decision gates">
      <ol>
        {PHASES.map((p, i) => (
          <li key={p.name} className={`hp-phase hp-act-${p.act.toLowerCase()}`}>
            <span className="hp-phase-act">{p.act}</span>
            <span className="hp-phase-card"><span className="hp-phase-n">{p.n}</span><b>{p.name}</b><i>{p.note}</i></span>
            {GATES[i] && <span className="hp-gate"><span className="hp-gate-dia" aria-hidden="true"><b>{GATES[i].id}</b></span><span className="hp-gate-text"><strong>Gate {GATES[i].id}</strong>{GATES[i].question}</span></span>}
          </li>
        ))}
      </ol>
      <figcaption>Decide, deliver, learn. Shipped is the middle of the story, not the end.</figcaption>
    </figure>
  );
}
