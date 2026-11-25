import type { SupabaseClient } from "@supabase/supabase-js";
import { gateErrorText, type AttentionKind, type ChecklistItem, type GateId, type GateOutcome, type GateRequest, type OutcomeReview, type Snooze } from "@pv/domain";

/** One gate decision as the approver gives it. */
export type Decision = {
  outcome: GateOutcome; rationale: string; fastLane: boolean; targetPhase: string | null; conditions: string[]; reviewDate: string | null;
};
export type ItemResult = { id: string; ok: boolean; message?: string };
export type Condition = { id: string; review_id: string; item_id: string; text: string; done_at: string | null };
export type Approvers = Record<GateId, string[]>;
/** The few item values the Decisions screen and the checklist need. */
export type GateItem = {
  id: string; item_code: string; initiative_name: string; initiative_phase: string | null; initiative_status: string | null; current_gate: string | null; gate_status: string | null;
  hypothesis: string | null; effort: string | null; moscow: string | null; health: string | null; kr_metric: string | null; home_project: string | null; start_experiment: string | null;
};
export type Decider = { user_id: string; email: string; role: string; is_approver: boolean; is_service_account: boolean };

/** Where the Decisions screen and the gate dialogs read and write. Supabase in the app, memory in tests. Every write is a database function that checks rights itself. */
export interface GateSource {
  loadRequests(): Promise<GateRequest[]>;
  /** The gates this person may decide (admins: all). */
  myGates(): Promise<GateId[]>;
  /** The documents of an item, for the checklist. */
  loadDocs(itemId: string): Promise<{ kind: string; status: string }[]>;
  /** The documents (kind and status only, never the text) of many items at once, for the Checklist column of the Decisions grid. */
  loadDocsFor(itemIds: string[]): Promise<Record<string, { kind: string; status: string }[]>>;
  requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[]; /** The people to ask; empty asks everyone who can decide. */ preferred?: string[] }[]): Promise<ItemResult[]>;
  decide(reviewIds: string[], d: Decision): Promise<(ItemResult & { phase?: string; fastLane?: boolean })[]>;
  /** Moves the phase. A move that passes a gate needs a person who can decide it and a comment (recorded as Skipped (fast lane)). */
  move(itemId: string, to: string, comment?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Sets Initiative Status to Completed; the database moves the phase to Completed and clears Health (docs/decisions/2026-11-25-completing-an-initiative.md). */
  complete(itemId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  loadConditions(itemId: string): Promise<Condition[]>;
  /** Conditions of any initiative that are not done yet (Needs attention). */
  loadOpenConditions(): Promise<{ item_id: string; text: string }[]>;
  doneCondition(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  loadItems(ids: string[]): Promise<GateItem[]>;
  loadDeciders(): Promise<Decider[]>;
  loadApprovers(): Promise<Approvers>;
  /** Admin or Approver: syncing of a finished initiative starts again (a fresh grace period). */
  resumeSync(itemId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  setApprovers(gate: GateId, userIds: string[]): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The 30, 60 and 90 day outcome reviews of every initiative (asked for or recorded). */
  loadOutcomeReviews(): Promise<OutcomeReview[]>;
  /** Asks the Product Manager (else the creator) for the metrics of a checkpoint; they get a notification. */
  requestOutcomeReview(itemId: string, days: number): Promise<{ ok: true } | { ok: false; error: string }>;
  recordOutcomeReview(itemId: string, days: number, v: { value: number | null; adoption: number | null; note: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Needs attention: the reasons someone snoozed or dismissed. Only a view filter; nothing about an initiative changes. */
  loadSnoozes(): Promise<Snooze[]>;
  /** Snoozes (until a date) or dismisses (`until` null) one reason on each initiative; asking again changes the date. */
  snooze(itemIds: string[], kind: AttentionKind, until: string | null, note?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Brings a snoozed or dismissed reason back. */
  unsnooze(itemIds: string[], kind: AttentionKind): Promise<{ ok: true } | { ok: false; error: string }>;
}

type DbError = { code?: string; message?: string } | null;
const text = (e: DbError) => gateErrorText(e?.code, e?.message);

const COLUMNS = "id,item_id,gate,kind,requested_by,requested_at,preferred_approvers,ready,criteria,outcome,rationale,fast_lane,target_phase,skipped_phases,review_date,decided_by,decided_at,withdrawn_at";

export class SupabaseGateSource implements GateSource {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

  async loadRequests(): Promise<GateRequest[]> {
    const { data, error } = await this.client.from("gate_reviews").select(COLUMNS).eq("tenant_id", this.tenantId).order("requested_at", { ascending: false }).limit(1000);
    if (error) throw new Error(text(error));
    return (data ?? []) as unknown as GateRequest[];
  }

  async myGates(): Promise<GateId[]> {
    const { data, error } = await this.client.rpc("my_decidable_gates", { p_tenant: this.tenantId });
    if (error) throw new Error(text(error));
    return (data ?? []) as GateId[];
  }

  async loadDocs(itemId: string) {
    const { data, error } = await this.client.from("item_documents").select("kind,status").eq("tenant_id", this.tenantId).eq("item_id", itemId);
    if (error) throw new Error(text(error));
    return (data ?? []) as { kind: string; status: string }[];
  }

  async loadDocsFor(itemIds: string[]) {
    const out: Record<string, { kind: string; status: string }[]> = {};
    for (let i = 0; i < itemIds.length; i += 100) {
      const { data, error } = await this.client.from("item_documents").select("item_id,kind,status").eq("tenant_id", this.tenantId).in("item_id", itemIds.slice(i, i + 100));
      if (error) throw new Error(text(error));
      for (const d of (data ?? []) as { item_id: string; kind: string; status: string }[]) (out[d.item_id] ??= []).push({ kind: d.kind, status: d.status });
    }
    return out;
  }

  async requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[]; preferred?: string[] }[]): Promise<ItemResult[]> {
    const { data, error } = await this.client.rpc("request_gates", { p_gate: gate, p_requests: items });
    if (error) return items.map((i) => ({ id: i.item, ok: false, message: text(error) }));
    return ((data ?? []) as { item: string; ok: boolean; error?: string; code?: string }[]).map((r) => ({ id: r.item, ok: r.ok, ...(r.ok ? {} : { message: gateErrorText(r.code, r.error) }) }));
  }

  async decide(reviewIds: string[], d: Decision) {
    const { data, error } = await this.client.rpc("decide_gates", {
      p_reviews: reviewIds, p_outcome: d.outcome, p_rationale: d.rationale, p_fast_lane: d.fastLane, p_target_phase: d.targetPhase,
      p_conditions: d.conditions, p_review_date: d.reviewDate,
    });
    if (error) return reviewIds.map((id) => ({ id, ok: false, message: text(error) }));
    return ((data ?? []) as { review_id: string; ok: boolean; error?: string; code?: string; phase?: string; fast_lane?: boolean }[]).map((r) => ({
      id: r.review_id, ok: r.ok, ...(r.ok ? { ...(r.phase ? { phase: r.phase } : {}), fastLane: Boolean(r.fast_lane) } : { message: gateErrorText(r.code, r.error) }),
    }));
  }

  async move(itemId: string, to: string, comment?: string) {
    const { error } = await this.client.rpc("move_phase", { p_item: itemId, p_to: to, p_comment: comment ?? null });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async complete(itemId: string) {
    const { error } = await this.client.from("items").update({ initiative_status: "Completed" }).eq("tenant_id", this.tenantId).eq("id", itemId);
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async loadConditions(itemId: string): Promise<Condition[]> {
    const { data, error } = await this.client.from("gate_conditions").select("id,review_id,item_id,text,done_at").eq("tenant_id", this.tenantId).eq("item_id", itemId).order("created_at");
    if (error) throw new Error(text(error));
    return (data ?? []) as Condition[];
  }

  async loadOpenConditions() {
    const { data, error } = await this.client.from("gate_conditions").select("item_id,text").eq("tenant_id", this.tenantId).is("done_at", null).limit(1000);
    if (error) throw new Error(text(error));
    return (data ?? []) as { item_id: string; text: string }[];
  }

  async doneCondition(id: string) {
    const { error } = await this.client.rpc("gate_condition_done", { p_condition: id });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async loadItems(ids: string[]): Promise<GateItem[]> {
    const out: GateItem[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await this.client.from("items").select("id,item_code,initiative_name,initiative_phase,initiative_status,current_gate,gate_status,hypothesis,effort,moscow,health,kr_metric,home_project_id,start_experiment")
        .eq("tenant_id", this.tenantId).in("id", ids.slice(i, i + 100));
      if (error) throw new Error(text(error));
      for (const r of (data ?? []) as unknown as (Omit<GateItem, "home_project"> & { home_project_id: string | null })[]) out.push({ ...r, home_project: r.home_project_id });
    }
    return out;
  }

  async loadDeciders(): Promise<Decider[]> {
    const { data, error } = await this.client.rpc("tenant_directory", { p_tenant: this.tenantId });
    if (error) throw new Error(text(error));
    return (data ?? []) as Decider[];
  }

  async loadApprovers(): Promise<Approvers> {
    const { data, error } = await this.client.from("tenant_gate_approvers").select("gate,user_id").eq("tenant_id", this.tenantId);
    if (error) throw new Error(text(error));
    const out: Approvers = { A: [], B: [], C: [] };
    for (const r of (data ?? []) as { gate: GateId; user_id: string }[]) out[r.gate].push(r.user_id);
    return out;
  }

  async resumeSync(itemId: string) {
    const { error } = await this.client.rpc("resume_sync", { p_item: itemId });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async setApprovers(gate: GateId, userIds: string[]) {
    const { error } = await this.client.rpc("set_gate_approvers", { p_tenant: this.tenantId, p_gate: gate, p_users: userIds });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async loadSnoozes(): Promise<Snooze[]> {
    const { data, error } = await this.client.from("attention_snoozes").select("item_id,kind,snoozed_until,note").eq("tenant_id", this.tenantId).limit(5000);
    if (error) throw new Error(text(error));
    return (data ?? []) as Snooze[];
  }

  async snooze(itemIds: string[], kind: AttentionKind, until: string | null, note?: string) {
    // one function call: an existing snooze of the same reason changes its date (the unique key is workspace, initiative, reason); RLS decides who may
    const { error } = await this.client.rpc("snooze_attention", { p_tenant: this.tenantId, p_items: itemIds, p_kind: kind, p_until: until, p_note: note?.trim() || null });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async unsnooze(itemIds: string[], kind: AttentionKind) {
    const { error } = await this.client.from("attention_snoozes").delete().eq("tenant_id", this.tenantId).eq("kind", kind).in("item_id", itemIds);
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async loadOutcomeReviews(): Promise<OutcomeReview[]> {
    const { data, error } = await this.client.from("outcome_reviews").select("id,item_id,at_days,due_on,requested_at,requested_to,realised_kr_value,adoption_pct,notes,recorded_at").eq("tenant_id", this.tenantId).limit(5000);
    if (error) throw new Error(text(error));
    return (data ?? []) as OutcomeReview[];
  }

  async requestOutcomeReview(itemId: string, days: number) {
    const { error } = await this.client.rpc("request_outcome_review", { p_item: itemId, p_at_days: days });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async recordOutcomeReview(itemId: string, days: number, v: { value: number | null; adoption: number | null; note: string }) {
    const { error } = await this.client.rpc("record_outcome_review", { p_item: itemId, p_at_days: days, p_value: v.value, p_adoption: v.adoption, p_note: v.note });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }
}

/** In-memory source for component tests and the dev harness. Applies the same first-decision-wins rule as the database. */
export class MemoryGateSource implements GateSource {
  constructor(public requests: GateRequest[] = [], public can: GateId[] = ["A", "B", "C"], public docs: { kind: string; status: string }[] = [], public conditions: Condition[] = [], public approvers: Approvers = { A: [], B: [], C: [] }) {}
  calls: string[] = [];
  async loadRequests() { return this.requests.map((r) => ({ ...r })); }
  async myGates() { return [...this.can]; }
  async loadDocs() { return [...this.docs]; }
  async loadDocsFor(ids: string[]) { return Object.fromEntries(ids.map((id) => [id, [...this.docs]])); }
  snoozes: Snooze[] = [];
  async loadSnoozes() { return this.snoozes.map((z) => ({ ...z })); }
  async snooze(itemIds: string[], kind: AttentionKind, until: string | null, note?: string) {
    this.calls.push(`snooze ${itemIds.join(",")} ${kind} ${until ?? "dismissed"}`);
    for (const item_id of itemIds) { this.snoozes = this.snoozes.filter((z) => !(z.item_id === item_id && z.kind === kind)); this.snoozes.push({ item_id, kind, snoozed_until: until, note: note ?? null }); }
    return { ok: true as const };
  }
  async unsnooze(itemIds: string[], kind: AttentionKind) {
    this.calls.push(`unsnooze ${itemIds.join(",")} ${kind}`);
    this.snoozes = this.snoozes.filter((z) => !(itemIds.includes(z.item_id) && z.kind === kind));
    return { ok: true as const };
  }
  lastPreferred: string[] = [];
  async requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[]; preferred?: string[] }[]) {
    this.calls.push(`request ${gate} ${items.length}`);
    this.lastPreferred = items[0]?.preferred ?? [];
    return items.map((i) => {
      if (this.requests.some((r) => r.item_id === i.item && !r.decided_at && !r.withdrawn_at && r.kind === "decision")) return { id: i.item, ok: false, message: "A gate request is already open for this initiative" };
      this.requests.push({ id: `rev-${this.requests.length + 1}`, item_id: i.item, gate, kind: "decision", requested_by: "me", requested_at: new Date(1_800_000_000_000 + this.requests.length * 1000).toISOString(), preferred_approvers: [], ready: i.ready, criteria: i.criteria, outcome: null, rationale: null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null });
      return { id: i.item, ok: true };
    });
  }
  async decide(reviewIds: string[], d: Decision) {
    this.calls.push(`decide ${d.outcome} ${reviewIds.length}`);
    return reviewIds.map((id) => {
      const r = this.requests.find((x) => x.id === id);
      if (!r || r.decided_at || r.withdrawn_at) return { id, ok: false, message: "This request is already closed" };
      if (!this.can.includes(r.gate)) return { id, ok: false, message: `You do not have approval rights for gate ${r.gate}` };
      Object.assign(r, { outcome: d.outcome, rationale: d.rationale, fast_lane: d.fastLane, target_phase: d.targetPhase, decided_by: "me", decided_at: new Date(1_800_000_100_000).toISOString(), review_date: d.reviewDate });
      return { id, ok: true, fastLane: d.fastLane };
    });
  }
  /** Test pages: what a successful move does to the screen, and a failure to simulate. */
  onMove: ((itemId: string, to: string) => void) | null = null;
  failMove: string | null = null;
  async move(itemId: string, to: string, comment?: string) {
    this.calls.push(comment ? `move ${itemId} ${to} (${comment})` : `move ${itemId} ${to}`);
    if (this.failMove) return { ok: false as const, error: this.failMove };
    this.onMove?.(itemId, to);
    return { ok: true as const };
  }
  async complete(itemId: string) {
    this.calls.push(`complete ${itemId}`);
    if (this.failMove) return { ok: false as const, error: this.failMove };
    this.onMove?.(itemId, "Completed");
    return { ok: true as const };
  }
  async loadConditions(itemId: string) { return this.conditions.filter((c) => c.item_id === itemId); }
  async loadOpenConditions() { return this.conditions.filter((c) => !c.done_at).map((c) => ({ item_id: c.item_id, text: c.text })); }
  async doneCondition(id: string) { const c = this.conditions.find((x) => x.id === id); if (c) c.done_at = "2026-11-05T12:00:00Z"; return { ok: true as const }; }
  items: GateItem[] = [];
  deciders: Decider[] = [];
  async loadItems(ids: string[]) { return this.items.filter((i) => ids.includes(i.id)); }
  async loadDeciders() { return [...this.deciders]; }
  async loadApprovers() { return { A: [...this.approvers.A], B: [...this.approvers.B], C: [...this.approvers.C] }; }
  async resumeSync(itemId: string) { this.calls.push(`resume ${itemId}`); return { ok: true as const }; }
  async setApprovers(gate: GateId, userIds: string[]) { this.approvers[gate] = [...userIds]; return { ok: true as const }; }
  outcomeReviews: OutcomeReview[] = [];
  async loadOutcomeReviews() { return this.outcomeReviews.map((r) => ({ ...r })); }
  async requestOutcomeReview(itemId: string, days: number) {
    this.calls.push(`outcome-request ${itemId} ${days}`);
    if (this.outcomeReviews.some((r) => r.item_id === itemId && r.at_days === days)) return { ok: false as const, error: "The review has already been requested or recorded" };
    this.outcomeReviews.push({ item_id: itemId, at_days: days, due_on: "2027-01-01", requested_at: "2027-01-01T00:00:00Z", realised_kr_value: null, adoption_pct: null, notes: null, recorded_at: null });
    return { ok: true as const };
  }
  async recordOutcomeReview(itemId: string, days: number, v: { value: number | null; adoption: number | null; note: string }) {
    this.calls.push(`outcome-record ${itemId} ${days}`);
    const i = this.outcomeReviews.findIndex((r) => r.item_id === itemId && r.at_days === days);
    const row: OutcomeReview = { item_id: itemId, at_days: days, due_on: "2027-01-01", requested_at: this.outcomeReviews[i]?.requested_at ?? null, realised_kr_value: v.value, adoption_pct: v.adoption, notes: v.note || null, recorded_at: "2027-01-02T00:00:00Z" };
    if (i === -1) this.outcomeReviews.push(row); else this.outcomeReviews[i] = row;
    return { ok: true as const };
  }
}
