"use client";

import { CARD_FIELD_LIMIT, FIELD_BY_KEY, VISIBLE_FIELDS, cardFieldOffer, cardRenderLabel, fieldOptions, filterOptions, isCustomerSafe } from "@pv/domain";
import { useMemo, useState } from "react";
import { NoResults, SearchInput } from "@/components/search-list";
import { Popover } from "../portfolio/popover";
import type { GridItem } from "../portfolio/types";
import { CardFace, healthStripe } from "./card-face";

const ALL_FIELDS = fieldOptions(VISIBLE_FIELDS);
const GROUPS = [...new Set(VISIBLE_FIELDS.map((f) => f.group))];

type Props = {
  /** The fields on the cards now, in order. */
  chosen: readonly string[];
  /** What "Reset" goes back to: the view's own card fields. */
  defaultChosen: readonly string[];
  /** The fields that are the board's columns or swimlanes: they are not repeated on a card. */
  axes: readonly string[];
  customerSafe: boolean;
  /** A real card for the preview (the first on the board). */
  sample: GridItem | undefined;
  sampleOwner: string;
  today: Date;
  onApply: (chosen: string[]) => void;
};

function Body({ chosen: start, defaultChosen, axes, customerSafe, sample, sampleOwner, today, onApply, close }: Props & { close: () => void }) {
  const [chosen, setChosen] = useState<string[]>([...start]);
  const [query, setQuery] = useState("");
  const [drag, setDrag] = useState<{ key: string | null; over: string | null }>({ key: null, over: null });
  const full = chosen.length >= CARD_FIELD_LIMIT;
  const searching = query.trim() !== "";
  const matching = useMemo(() => new Set(filterOptions(ALL_FIELDS, query).map((o) => o.value)), [query]);

  const why = (k: string): string | null => {
    const o = cardFieldOffer(k);
    if (!o.ok) return o.reason;
    if (axes.includes(k)) return "Already the board's columns or swimlanes";
    if (customerSafe && !isCustomerSafe(k)) return "Not customer-safe";
    return null;
  };
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : c.length >= CARD_FIELD_LIMIT ? c : [...c, k]));
  const move = (k: string, delta: number) => setChosen((c) => {
    const i = c.indexOf(k), j = i + delta;
    if (i < 0 || j < 0 || j >= c.length) return c;
    const n = [...c]; [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });
  const drop = (target: string) => {
    const k = drag.key;
    setDrag({ key: null, over: null });
    if (!k || k === target) return;
    setChosen((c) => {
      const without = c.filter((x) => x !== k);
      const at = without.indexOf(target) + (c.indexOf(k) < c.indexOf(target) ? 1 : 0);
      return [...without.slice(0, at), k, ...without.slice(at)];
    });
  };
  // a field is listed when a card can show it; a search also lists the ones it cannot, greyed, with the reason
  const listed = (g: string) => VISIBLE_FIELDS.filter((f) => f.group === g && (searching ? matching.has(f.key) : cardFieldOffer(f.key).ok && !axes.includes(f.key)));
  const groups = GROUPS.filter((g) => listed(g).length > 0);

  return (
    <div role="group" aria-label="Choose card fields">
      <div className="panel-section" style={{ paddingBottom: 12 }}>
        <div className="panel-head">
          <h2>Card fields</h2>
          <span className="panel-note">Cards have room for {CARD_FIELD_LIMIT} fields. Rank, ID, name, health and owner are always shown. Nothing changes until you press Apply.</span>
        </div>
      </div>
      <hr className="panel-rule" />
      <div className="cp cp-body kf-body">
        <div className="cp-mid">
          <div className="cp-tools">
            <SearchInput value={query} onChange={setQuery} label="Search card fields" placeholder={`Search the ${VISIBLE_FIELDS.length} fields…`} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
          </div>
          {searching && groups.length === 0 && <NoResults query={query} />}
          {groups.map((g) => (
            <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="panel-head" style={{ padding: 0 }}><h2>{g}</h2></legend>
              <div className="cp-list">
                {listed(g).map((f) => {
                  const blocked = why(f.key);
                  const on = chosen.includes(f.key);
                  const offer = cardFieldOffer(f.key);
                  const stop = !on && full;
                  return (
                    <label key={f.key} className="cp-field" data-disabled={Boolean(blocked) || stop}>
                      <input type="checkbox" checked={on} disabled={Boolean(blocked) || stop} onChange={() => toggle(f.key)} />
                      <span>
                        {f.name}
                        {blocked ? <span className="columns-later"> · {blocked.toLowerCase()}</span>
                          : offer.ok ? <span className="columns-later"> · {cardRenderLabel(offer.render)}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="cp-order kf-side">
          <div className="panel-head"><h2>Card fields <span className="kf-count" data-full={full}>{chosen.length} of {CARD_FIELD_LIMIT}</span></h2></div>
          <p className="panel-note" style={{ margin: "4px 0 8px" }} role="status">
            {full ? "The card is full. Remove one to add another." : `${CARD_FIELD_LIMIT - chosen.length} more fit${CARD_FIELD_LIMIT - chosen.length === 1 ? "s" : ""}.`} Drag to reorder, or use the arrows: the order here is the order on the card.
          </p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Card fields in order">
            {chosen.map((k, i) => {
              const f = FIELD_BY_KEY[k];
              const offer = cardFieldOffer(k);
              return (
                <li key={k} data-column={k} className="cp-card" data-over={drag.over === k && drag.key !== k} draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDrag({ key: k, over: null }); }}
                  onDragOver={(e) => { if (drag.key) { e.preventDefault(); if (drag.over !== k) setDrag((d) => ({ ...d, over: k })); } }}
                  onDrop={(e) => { e.preventDefault(); drop(k); }} onDragEnd={() => setDrag({ key: null, over: null })}>
                  <span className="kf-n" aria-hidden="true">{i + 1}</span>
                  <span className="name">{f?.name ?? k}{offer.ok && <span className="columns-later"> · {cardRenderLabel(offer.render)}</span>}</span>
                  <button type="button" className="icon-btn" aria-label={`Move ${f?.name} up`} disabled={i === 0} onClick={() => move(k, -1)}>▲</button>
                  <button type="button" className="icon-btn" aria-label={`Move ${f?.name} down`} disabled={i === chosen.length - 1} onClick={() => move(k, 1)}>▼</button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${f?.name}`} onClick={() => toggle(k)}>
                    <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
                  </button>
                </li>
              );
            })}
          </ol>
          {chosen.length === 0 && <p className="panel-note">No fields chosen: cards show only the always-on parts.</p>}
          <div className="panel-head" style={{ marginTop: 10 }}><h2>Preview</h2></div>
          <div className="kcard kf-preview" data-stripe={sample ? healthStripe(String(sample.health ?? "")) : "none"} aria-label="Preview of a card" role="group">
            {sample
              ? <CardFace row={sample} fields={chosen.filter((k) => !axes.includes(k))} owner={sampleOwner} trackers={[]} today={today} preview />
              : <p className="panel-note">The preview shows your first card once the board has one.</p>}
          </div>
        </div>
      </div>
      <div className="panel-foot">
        <button type="button" className="btn btn-link" onClick={() => setChosen([...defaultChosen])}>Reset to view default</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { onApply(chosen); close(); }}>Apply card fields ({chosen.length} of {CARD_FIELD_LIMIT})</button>
      </div>
    </div>
  );
}

/** "Card fields: 3 of 5": expands a panel to choose and order the (at most five) fields cards show. */
export function CardFieldsPanel(props: Props) {
  return (
    <Popover wide staged label={<>Card fields: <strong className="count-badge">{props.chosen.length} of {CARD_FIELD_LIMIT}</strong></>}>
      {(close) => <Body {...props} close={close} />}
    </Popover>
  );
}
