"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { RULE_LABEL, type BatchOutcome, type IncomingIssue, type IncomingRule, type IncomingSource, type Ownership, type PullState } from "./types";

type Props = { source: IncomingSource; projects: { id: string; name: string }[]; canEdit: boolean; canAdmin: boolean; now?: number; /** Called after initiatives were created or removed here (a pull-in or its undo), so a grid behind this window can reload. */ onChanged?: () => void; /** Inside another window (the first step of Sync): a small heading instead of the page heading and no long introduction. */ embedded?: boolean };
type Undo = { label: string; run: () => Promise<string> };

const TABS: { id: PullState; label: string; hint: string }[] = [
  { id: "not_pulled", label: "Not pulled", hint: "Seen in GitHub, not part of the roadmap." },
  { id: "ignored", label: "Ignored", hint: "Left out on purpose. Nothing is ever written to these." },
  { id: "pulled", label: "Pulled in", hint: "Already initiatives; they follow their issue read-only." },
];
const SHOWN = 200;
const OWNERSHIP: { id: Ownership; label: string }[] = [{ id: "follow", label: "Read only" }, { id: "push", label: "Product Velocity owns it" }];
const DAY = 86_400_000;
const AGES = [{ id: "any", label: "Any age", days: 0 }, { id: "30", label: "Older than 30 days", days: 30 }, { id: "90", label: "Older than 90 days", days: 90 }, { id: "new", label: "Last 7 days", days: -7 }];

const shortRepo = (r: string) => r.split("/")[1] ?? r;
const failedText = (r: BatchOutcome[]) => { const bad = r.filter((x) => !x.ok); return bad.length ? ` ${bad.length} could not be changed: ${bad[0]!.reason}` : ""; };

/**
 * The Incoming list (R-024): everything GitHub has that is not an initiative yet. Choose what comes in (Pull in), what stays out
 * (Ignore), and let saved rules decide for new arrivals. Nothing here writes to GitHub; ignored and not-pulled issues are
 * not initiatives, so they are in no grid, rank, cycle or report.
 */
export function IncomingView({ source, projects, canEdit, canAdmin, now: nowProp, onChanged, embedded = false }: Props) {
  const [issues, setIssues] = useState<IncomingIssue[] | null>(null);
  const [rules, setRules] = useState<IncomingRule[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<PullState>("not_pulled");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [label, setLabel] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState("");
  const [age, setAge] = useState("any");
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [ownership, setOwnership] = useState<Ownership>("follow");
  const [reason, setReason] = useState("");
  const [saveRule, setSaveRule] = useState(false);
  const [shown, setShown] = useState(SHOWN);
  const [children, setChildren] = useState<IncomingIssue[] | null>(null);
  const [now] = useState(() => nowProp ?? Date.now());
  const id = useId();

  const reload = async () => {
    try {
      const r = await source.load();
      setIssues(r.issues); setRules(r.rules); setConnectionId(r.connectionId); setError(null);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    let cancelled = false;
    source.load().then((r) => { if (!cancelled) { setIssues(r.issues); setRules(r.rules); setConnectionId(r.connectionId); } }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [source]);

  const all = useMemo(() => issues ?? [], [issues]);
  const counts = useMemo(() => ({ not_pulled: all.filter((i) => i.pullState === "not_pulled").length, ignored: all.filter((i) => i.pullState === "ignored").length, pulled: all.filter((i) => i.pullState === "pulled").length }), [all]);
  const options = useMemo(() => ({
    types: [...new Set(all.map((i) => i.issueType).filter((t): t is string => !!t))].sort(),
    labels: [...new Set(all.flatMap((i) => i.labels))].sort(),
    repos: [...new Set(all.map((i) => i.repo))].sort(),
  }), [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((i) => {
      if (i.pullState !== tab) return false;
      if (needle && !`${i.title} #${i.number} ${i.labels.join(" ")}`.toLowerCase().includes(needle)) return false;
      if (type && i.issueType !== type) return false;
      if (label && !i.labels.includes(label)) return false;
      if (repo && i.repo !== repo) return false;
      if (state && i.state !== state) return false;
      const a = AGES.find((x) => x.id === age)!;
      if (a.days !== 0 && i.updatedAt) {
        const days = (now - Date.parse(i.updatedAt)) / DAY;
        if (a.days > 0 ? days < a.days : days > -a.days) return false;
      }
      return true;
    });
  }, [all, tab, q, type, label, repo, state, age, now]);
  // A saved rule is one condition (type, label or repository). Several rules combine as "any of them", so a filter with more than one condition
  // (or a search, state or age) could not be saved without ignoring more than the person selected: it is not offered.
  const setFilters = [type && ({ kind: "type", value: type } as const), label && ({ kind: "label", value: label } as const), repo && ({ kind: "repo", value: repo } as const)].filter((x): x is { kind: IncomingRule["kind"]; value: string } => !!x);
  const otherFilter = q.trim() !== "" || state !== "" || age !== "any";
  const ruleCandidate = setFilters.length === 1 && !otherFilter ? setFilters[0]! : null;
  const visible = rows.slice(0, shown);
  const chosen = rows.filter((r) => picked.has(r.id));
  const allPicked = visible.length > 0 && visible.every((r) => picked.has(r.id));
  const toggle = (rid: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(rid)) n.add(rid); return n; });

  const apply = (outcomes: BatchOutcome[], patch: (i: IncomingIssue, o: BatchOutcome) => IncomingIssue) => {
    const ok = new Map(outcomes.filter((o) => o.ok).map((o) => [o.id, o]));
    setIssues((cur) => (cur ?? []).map((i) => (ok.has(i.id) ? patch(i, ok.get(i.id)!) : i)));
    setPicked(new Set());
  };

  const setStateFor = async (list: IncomingIssue[], next: "not_pulled" | "ignored", why: string | null) => {
    const before = new Map(list.map((i) => [i.id, { state: i.pullState, reason: i.ignoreReason }]));
    setBusy(true); setMessage(null); setChildren(null);
    const r = await source.setState(list.map((i) => i.id), next, why);
    setBusy(false);
    const done = r.filter((o) => o.ok);
    apply(r, (i) => ({ ...i, pullState: next, ignoreReason: next === "ignored" ? (why || null) : null }));
    if (done.length === 0) { setMessage(`Nothing changed.${failedText(r)}`); return; }
    setMessage(`${next === "ignored" ? "Ignored" : "Moved back to Not pulled:"} ${done.length} ${done.length === 1 ? "issue" : "issues"}.${failedText(r)}`);
    // one undo step for the whole batch: put each issue back where it was
    setUndo({
      label: `Undo ${next === "ignored" ? "ignore" : "bring back"}`,
      run: async () => {
        const groups = new Map<string, string[]>();
        for (const o of done) { const b = before.get(o.id)!; const k = `${b.state}|${b.reason ?? ""}`; groups.set(k, [...(groups.get(k) ?? []), o.id]); }
        for (const [k, ids] of groups) { const [st, ...rs] = k.split("|"); await source.setState(ids, st as "not_pulled" | "ignored", rs.join("|") || null); }
        await reload();
        return `Put ${done.length} ${done.length === 1 ? "issue" : "issues"} back.`;
      },
    });
  };

  const ignore = async () => {
    // ignoring a parent suggests ignoring its children too (the person confirms)
    const kids = all.filter((i) => i.pullState === "not_pulled" && i.parentNumber !== null && !picked.has(i.id) && chosen.some((p) => p.repo === i.repo && p.number === i.parentNumber));
    if (kids.length > 0 && children === null) { setChildren(kids); return; }
    await setStateFor(chosen, "ignored", reason.trim() || null);
    setReason("");
    await rememberRule();
  };
  const ignoreWithChildren = async () => { const list = [...chosen, ...(children ?? [])]; setChildren(null); await setStateFor(list, "ignored", reason.trim() || null); setReason(""); await rememberRule(); };
  /** "Also ignore future issues like this": saves the one condition of the filter as a rule, for issues that arrive from now on. */
  const rememberRule = async () => {
    if (!saveRule || !ruleCandidate || !canAdmin) return;
    setSaveRule(false);
    const r = await source.addRule(connectionId, ruleCandidate.kind, ruleCandidate.value);
    if (!r.ok) { setMessage((m) => `${m ?? ""} The rule was not saved: ${r.error}`.trim()); return; }
    setMessage((m) => `${m ?? ""} Saved for issues that arrive from now on: ${RULE_LABEL[ruleCandidate.kind]} ${ruleCandidate.value} → Ignore.`.trim());
    await reload();
  };

  const pull = async () => {
    if (!project || chosen.length === 0) return;
    setBusy(true); setMessage(null);
    const r = await source.pullIn(chosen.map((i) => i.id), project, ownership);
    setBusy(false);
    const done = r.filter((o) => o.ok);
    apply(r, (i, o) => ({ ...i, pullState: "pulled", itemId: o.itemId ?? null, ignoreReason: null }));
    if (done.length === 0) { setMessage(`Nothing was pulled in.${failedText(r)}`); return; }
    onChanged?.();
    const where = projects.find((p) => p.id === project)?.name ?? "the project";
    setMessage(`Pulled ${done.length} ${done.length === 1 ? "issue" : "issues"} into ${where} as initiatives (${done.slice(0, 3).map((o) => o.itemCode).filter(Boolean).join(", ")}${done.length > 3 ? ", …" : ""}). ${ownership === "push" ? "Product Velocity owns what they are; nothing is written to GitHub until you sync and confirm" : "They follow the issue read-only"}; nothing was written to GitHub.${failedText(r)}`);
    setUndo({
      label: "Undo pull in",
      run: async () => {
        const items = done.map((o) => o.itemId).filter((x): x is string => !!x);
        const d = await source.discardItems(items);
        if (!d.ok) return `Could not undo: ${d.error}`;
        await source.setState(done.map((o) => o.id), "not_pulled", null);
        await reload();
        onChanged?.();
        return `Removed the ${items.length} new ${items.length === 1 ? "initiative" : "initiatives"} again.`;
      },
    });
  };

  const addRule = async (form: FormData) => {
    const kind = String(form.get("kind")) as IncomingRule["kind"];
    const value = String(form.get("value") ?? "").trim();
    if (!value) return;
    const r = await source.addRule(connectionId, kind, value);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setMessage(`Rule saved. It applies to issues that arrive from now on; it never changes issues already here.`);
    await reload();
  };
  const removeRule = async (rid: string) => { const r = await source.removeRule(rid); if (!r.ok) setError(r.error); await reload(); };

  if (error && !issues) return <><div className="page-head"><h1>Incoming</h1></div><div role="alert" className="error">{error}</div></>;
  if (!issues) return <><div className="page-head"><h1>Incoming</h1></div><p role="status" className="muted">Loading the incoming issues…</p></>;

  return (
    <>
      {embedded ? <h3>New issues in GitHub</h3> : <div className="page-head"><h1>Incoming</h1></div>}
      {!embedded && <p className="muted">Issues in GitHub that are not initiatives. Nothing comes into the roadmap just because it exists: pull in what belongs, ignore the rest (bugs, chores, support). Both can be changed any time, and nothing here ever writes to GitHub.</p>}
      {error && <div role="alert" className="error">{error}</div>}
      <p role="status" className="trash-status">
        {message}
        {undo && <> <button type="button" className="link-button" disabled={busy} onClick={async () => { const u = undo; setUndo(null); setBusy(true); const m = await u.run(); setBusy(false); setMessage(m); }}>{undo.label}</button></>}
      </p>

      <div className="incoming-tabs" role="tablist" aria-label="Incoming issues by choice">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "ip-tab ip-tab-on" : "ip-tab"} onClick={() => { setTab(t.id); setPicked(new Set()); setShown(SHOWN); }}>
            {t.label} <span className="muted">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <p className="muted">{TABS.find((t) => t.id === tab)!.hint}</p>

      <div className="incoming-filters">
        <input type="search" aria-label="Search the incoming issues" placeholder="Search title, number or label" value={q} onChange={(e) => { setQ(e.target.value); setShown(SHOWN); }} />
        <select aria-label="Issue type" value={type} onChange={(e) => setType(e.target.value)}><option value="">Any type</option>{options.types.map((t) => <option key={t}>{t}</option>)}</select>
        <select aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)}><option value="">Any label</option>{options.labels.map((t) => <option key={t}>{t}</option>)}</select>
        <select aria-label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)}><option value="">Any repository</option>{options.repos.map((t) => <option key={t} value={t}>{shortRepo(t)}</option>)}</select>
        <select aria-label="Issue state" value={state} onChange={(e) => setState(e.target.value)}><option value="">Open and closed</option><option value="open">Open</option><option value="closed">Closed</option></select>
        <select aria-label="Last activity" value={age} onChange={(e) => setAge(e.target.value)}>{AGES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      </div>

      {rows.length === 0 ? <p>{all.length === 0 ? "No issues yet. Press “Check GitHub now” above to read them." : "Nothing here."}</p> : (
        <>
          <div className="incoming-pick">
            <span>{canEdit && tab !== "pulled" ? <><strong>{picked.size}</strong> of {rows.length} {rows.length === 1 ? "issue" : "issues"} selected</> : <>{rows.length} {rows.length === 1 ? "issue" : "issues"}</>}{rows.length > visible.length ? `, showing the first ${visible.length}` : ""}</span>
            {canEdit && tab !== "pulled" && (
              <span className="incoming-pick-buttons">
                <button type="button" className="btn" onClick={() => setPicked(new Set(visible.map((r) => r.id)))}>Select all shown</button>
                <button type="button" className="btn" onClick={() => setPicked(new Set(visible.filter((r) => !picked.has(r.id)).map((r) => r.id)))}>Invert selection</button>
                <button type="button" className="btn" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>Clear</button>
              </span>
            )}
          </div>
          <div className="incoming-scroll" tabIndex={0} role="region" aria-label="Issues">
            <table className="trash-table incoming-table">
              <thead>
                <tr>
                  <th scope="col">{canEdit && tab !== "pulled" && <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(visible.map((r) => r.id)))} />}</th>
                  <th scope="col">Issue</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Labels</th><th scope="col">State</th><th scope="col">{tab === "ignored" ? "Reason" : "Last activity"}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => {
                  const parent = i.parentNumber !== null ? all.find((p) => p.repo === i.repo && p.number === i.parentNumber) : null;
                  return (
                    <tr key={i.id}>
                      <td>{canEdit && tab !== "pulled" && <input type="checkbox" aria-label={`Select #${i.number} ${i.title}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} />}</td>
                      <td className="mono">{i.url ? <a href={i.url} target="_blank" rel="noreferrer">#{i.number}</a> : `#${i.number}`} <span className="muted">{shortRepo(i.repo)}</span></td>
                      <td>{i.title}{i.parentNumber !== null && <span className="muted"> · sub-issue of #{i.parentNumber}{parent ? ` “${parent.title.slice(0, 40)}” (${parent.pullState === "pulled" ? "pulled in" : parent.pullState === "ignored" ? "ignored" : "not pulled"})` : ""}</span>}</td>
                      <td>{i.issueType ?? <span className="muted">none</span>}</td>
                      <td>{i.labels.length ? i.labels.join(", ") : <span className="muted">none</span>}</td>
                      <td>{i.state === "open" ? "Open" : "Closed"}</td>
                      <td>{tab === "ignored" ? (i.ignoreReason ?? <span className="muted">no reason given</span>) : i.updatedAt ? new Date(i.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > visible.length && <p><button type="button" className="btn" onClick={() => setShown((n) => n + SHOWN)}>Show {Math.min(SHOWN, rows.length - visible.length)} more</button></p>}
        </>
      )}

      {canEdit && tab !== "pulled" && (
        <section className="incoming-bring" aria-label="Bring in the selected issues">
          <h3>{tab === "not_pulled" ? "What to do with the selected issues" : "Bring the selected issues back"}</h3>
          <div className="incoming-actions">
            <label className="in-field"><span>Pull in to project</span>
              <select value={project} onChange={(e) => setProject(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <label className="in-field"><span>Who owns the new initiatives</span>
              <select value={ownership} onChange={(e) => setOwnership(e.target.value as Ownership)}>{OWNERSHIP.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            </label>
            <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0 || !project} onClick={() => void pull()}>Pull in {picked.size > 0 ? picked.size : ""}</button>
          </div>
          {tab === "not_pulled" && (
            <div className="incoming-actions">
              <label className="in-field in-grow"><span>Reason for ignoring (optional)</span>
                <input placeholder="For example: support request" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button type="button" className="btn" disabled={busy || picked.size === 0} onClick={() => void ignore()}>Ignore {picked.size > 0 ? picked.size : ""}</button>
              {canAdmin && ruleCandidate && (
                <label className="in-check"><input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} /> Also ignore future issues like this ({RULE_LABEL[ruleCandidate.kind].toLowerCase()} <strong>{ruleCandidate.value}</strong>)</label>
              )}
              {canAdmin && !ruleCandidate && (setFilters.length > 0 || otherFilter) && (
                <span className="muted in-note">To also ignore future issues like these, filter on exactly one of type, label or repository, with no search, state or age.</span>
              )}
            </div>
          )}
          {tab === "ignored" && (
            <div className="incoming-actions">
              <button type="button" className="btn" disabled={busy || picked.size === 0} onClick={() => void setStateFor(chosen, "not_pulled", null)}>Bring back to Not pulled</button>
            </div>
          )}
        </section>
      )}
      {children && (
        <div role="alertdialog" aria-label="Ignore the sub-issues too?" className="notice">
          <p>{children.length} of the selected issues {children.length === 1 ? "has a parent" : "have parents"} that you are ignoring: {children.slice(0, 3).map((c) => `#${c.number}`).join(", ")}{children.length > 3 ? ", …" : ""}. Ignore {children.length === 1 ? "it" : "them"} too?</p>
          <button type="button" className="btn btn-primary" onClick={() => void ignoreWithChildren()}>Ignore them too</button>{" "}
          <button type="button" className="btn" onClick={() => { const list = chosen; setChildren(null); void setStateFor(list, "ignored", reason.trim() || null).then(rememberRule); setReason(""); }}>Only the selected</button>
        </div>
      )}

      <section className="incoming-rules" aria-labelledby={`${id}-rules`}>
        <h2 id={`${id}-rules`}>Rules for future arrivals</h2>
        <p className="muted">A rule applies only to issues that arrive from now on: when one appears for the first time and matches, it is ignored instead of waiting in Not pulled. A rule never changes issues that are already here, nor initiatives already pulled in, and it never pulls anything in. Several rules work as “any of these”.</p>
        {rules.length === 0 && <p className="muted">No rules yet.</p>}
        <ul>
          {rules.map((r) => (
            <li key={r.id}>{RULE_LABEL[r.kind]} <strong>{r.value}</strong> → Ignore {canAdmin && <button type="button" className="link-button" aria-label={`Remove the rule ${RULE_LABEL[r.kind]} ${r.value}`} onClick={() => void removeRule(r.id)}>Remove</button>}</li>
          ))}
        </ul>
        {canAdmin && (
          <form action={(f) => void addRule(f)} className="row-form">
            <select name="kind" aria-label="Rule kind" defaultValue="type"><option value="type">Issue type is</option><option value="label">Label is</option><option value="repo">Repository is</option></select>
            <input name="value" aria-label="Rule value" placeholder="Bug, support, Acme/ops…" maxLength={120} required />
            <span>→ Ignore</span>
            <button type="submit" className="btn">Add rule</button>
          </form>
        )}
        {!canAdmin && <p className="muted">Only admins change the rules.</p>}
      </section>
    </>
  );
}
