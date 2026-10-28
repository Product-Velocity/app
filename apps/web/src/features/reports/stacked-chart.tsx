"use client";

import { drillOn, type ReportDim, type ReportState, type Stacked } from "@pv/domain";

const PALETTE = ["#3347d9", "#0f8a6a", "#c27a00", "#a23b8f", "#2b7fb8", "#b4472f", "#5b6577", "#6a8f1f", "#8f5bd6", "#1f7a8c"];

type Props = {
  title: string;
  note?: string;
  data: Stacked;
  rowDim: ReportDim;
  colDim: ReportDim;
  label: (dim: ReportDim, key: string) => string;
  state: ReportState;
  /** Show each bar as 100% (the share of each value) instead of counts. */
  percent?: boolean;
  /** Click a segment (row and column), a row name (row only) or a legend item (column only). */
  onPick: (picks: { dim: ReportDim; key: string }[]) => void;
};

/**
 * A stacked horizontal bar chart made of buttons. Every segment says its numbers in words (the count is printed in the segment and in
 * its label), the legend names each colour, and the whole chart is a list a keyboard and a screen reader can walk through.
 */
export function StackedChart({ title, note, data, rowDim, colDim, label, state, percent = false, onPick }: Props) {
  const max = Math.max(1, ...data.rows.map((r) => r.total));
  const colour = (c: string) => PALETTE[Math.max(0, data.columns.indexOf(c)) % PALETTE.length]!;
  return (
    <section className="rp-card" aria-label={title}>
      <h2 className="rp-title">{title}</h2>
      {note && <p className="rp-note">{note}</p>}
      {data.rows.length === 0 ? (
        <p className="rp-empty" role="status">No data matching current filters</p>
      ) : (
        <>
          <ul className="rp-legend" aria-label={`${label(colDim, "")} legend`}>
            {data.columns.map((c) => (
              <li key={c}>
                <button type="button" className="rp-legend-item" aria-pressed={drillOn(state, colDim, c)} onClick={() => onPick([{ dim: colDim, key: c }])}>
                  <span className="rp-swatch" style={{ background: colour(c) }} aria-hidden="true" />{label(colDim, c)}
                </button>
              </li>
            ))}
          </ul>
          <ul className="rp-rows">
            {data.rows.map((r) => (
              <li key={r.key} className="rp-row">
                <button type="button" className="rp-rowname" aria-pressed={drillOn(state, rowDim, r.key)} onClick={() => onPick([{ dim: rowDim, key: r.key }])} title={label(rowDim, r.key)}>
                  {label(rowDim, r.key)}
                </button>
                <span className="rp-bar" style={{ width: `${percent ? 100 : (r.total / max) * 100}%` }}>
                  {data.columns.filter((c) => r.cells[c]).map((c) => {
                    const n = r.cells[c]!;
                    const pct = Math.round((n / r.total) * 100);
                    const on = drillOn(state, rowDim, r.key) && drillOn(state, colDim, c);
                    return (
                      <button
                        key={c} type="button" className={on ? "rp-seg rp-seg-on" : "rp-seg"} style={{ flexGrow: n, background: colour(c) }}
                        aria-pressed={on} aria-label={`${label(rowDim, r.key)}, ${label(colDim, c)}: ${n}${percent ? ` (${pct}%)` : ""}`} title={`${label(rowDim, r.key)} · ${label(colDim, c)}: ${n} (${pct}%)`}
                        onClick={() => onPick([{ dim: rowDim, key: r.key }, { dim: colDim, key: c }])}
                      >{percent ? `${pct}%` : n}</button>
                    );
                  })}
                </span>
                <span className="rp-total">{r.total}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
