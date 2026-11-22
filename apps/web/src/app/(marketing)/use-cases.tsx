"use client";
import { useState, type KeyboardEvent } from "react";
import { PV2_UC_HEAD, PV2_UC_PANELS, pv2Prog } from "./art-v2";

/** 04 Use cases: five jobs in a tab list (Align, Decide, Deliver, Report, Learn). The panels are static example-data markup from art-v2.ts. */
export function UseCases() {
  const [i, setI] = useState(0);
  const last = PV2_UC_PANELS.length - 1;
  const onKey = (e: KeyboardEvent) => {
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setI(next);
    document.getElementById(`uc-tab-${next}`)?.focus();
  };
  return (
    <section className="band white" id="usecases">
      <div className="prog" data-n="4" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pv2Prog(4) }} />
      <div className="ch one">
        <div className="head" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: PV2_UC_HEAD }} />
        <div className="uc-tabs" role="tablist" aria-label="The five jobs" onKeyDown={onKey}>
          {PV2_UC_PANELS.map((p, k) => (
            <button key={p.k} type="button" role="tab" id={`uc-tab-${k}`} aria-selected={k === i} aria-controls="uc-panel" tabIndex={k === i ? 0 : -1} onClick={() => setI(k)}>{p.k}</button>
          ))}
        </div>
        <div id="uc-panel" role="tabpanel" aria-labelledby={`uc-tab-${i}`} dangerouslySetInnerHTML={{ __html: PV2_UC_PANELS[i]!.html }} />
      </div>
    </section>
  );
}
