"use client";
import { useState } from "react";

/** Three views of the same four initiatives (example data). The panel is the only interactive picture on the homepage. */
type Health = "g" | "w" | "r";
const ROWS: { name: string; health: string; h: Health; stage: string; delivery: string; tracker: string; outcome: string; gate: string }[] = [
  { name: "Checkout redesign", health: "On track", h: "g", stage: "Build", delivery: "64%", tracker: "PV-218", outcome: "Higher conversion", gate: "B passed" },
  { name: "Publisher onboarding", health: "At risk", h: "w", stage: "Define", delivery: "n/a", tracker: "not synced", outcome: "Faster activation", gate: "B pending" },
  { name: "Audience insights API", health: "On track", h: "g", stage: "Test", delivery: "91%", tracker: "#412", outcome: "More revenue", gate: "B passed" },
  { name: "Ad quality scoring", health: "Blocked", h: "r", stage: "Discover", delivery: "n/a", tracker: "not synced", outcome: "Fewer rejections", gate: "A pending" },
];
const pill = (r: (typeof ROWS)[number]) => <span className={`pill ${r.h}`}>{r.health}</span>;
const VIEWS: { name: string; cols: string[]; cells: (r: (typeof ROWS)[number]) => React.ReactNode[] }[] = [
  { name: "Leadership", cols: ["Initiative", "Health", "Business outcome"], cells: (r) => [r.name, pill(r), r.outcome] },
  { name: "Product team", cols: ["Initiative", "Stage", "Health", "Gate"], cells: (r) => [r.name, r.stage, pill(r), r.gate] },
  { name: "Delivery", cols: ["Initiative", "Delivery", "Tracker"], cells: (r) => [r.name, r.delivery, <span key="t" className="mono">{r.tracker}</span>] },
];

export function ViewTabs() {
  const [i, setI] = useState(0);
  const v = VIEWS[i]!;
  return (
    <div className="panel" aria-label="Three views of the same roadmap (example data)">
      <div className="tabs" role="tablist">
        {VIEWS.map((x, k) => (
          <button key={x.name} type="button" role="tab" id={`vt-tab-${k}`} aria-selected={k === i} aria-controls="vt-panel" onClick={() => setI(k)}>{x.name}</button>
        ))}
      </div>
      <div className="mc tbl2" role="tabpanel" id="vt-panel" aria-labelledby={`vt-tab-${i}`}>
        <table>
          <thead><tr>{v.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{ROWS.map((r) => <tr key={r.name}>{v.cells(r).map((c, k) => <td key={k}>{k === 0 ? <b>{c}</b> : c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <span className="m2">Same data, different columns. Click a view.</span>
    </div>
  );
}
