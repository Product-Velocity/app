import type { SupabaseClient } from "@supabase/supabase-js";
import { gateErrorText, type ChecklistItem, type GateId, type GateOutcome, type GateRequest } from "@pv/domain";

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
  requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[] }[]): Promise<ItemResult[]>;
  decide(reviewIds: string[], d: Decision): Promise<(ItemResult & { phase?: string; fastLane?: boolean })[]>;
  move(itemId: string, to: string): Promise<{ ok: true } | { ok: false; error: string }>;
  loadConditions(itemId: string): Promise<Condition[]>;
  doneCondition(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  loadItems(ids: string[]): Promise<GateItem[]>;
  loadDeciders(): Promise<Decider[]>;
  loadApprovers(): Promise<Approvers>;
  /** Admin or Approver: syncing of a finished initiative starts again (a fresh grace period). */
  resumeSync(itemId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  setApprovers(gate: GateId, userIds: string[]): Promise<{ ok: true } | { ok: false; error: string }>;
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

  async requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[] }[]): Promise<ItemResult[]> {
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

  async move(itemId: string, to: string) {
    const { error } = await this.client.rpc("move_phase", { p_item: itemId, p_to: to });
    return error ? { ok: false as const, error: text(error) } : { ok: true as const };
  }

  async loadConditions(itemId: string): Promise<Condition[]> {
    const { data, error } = await this.client.from("gate_conditions").select("id,review_id,item_id,text,done_at").eq("tenant_id", this.tenantId).eq("item_id", itemId).order("created_at");
    if (error) throw new Error(text(error));
    return (data ?? []) as Condition[];
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
}

/** In-memory source for component tests and the dev harness. Applies the same first-decision-wins rule as the database. */
export class MemoryGateSource implements GateSource {
  constructor(public requests: GateRequest[] = [], public can: GateId[] = ["A", "B", "C"], public docs: { kind: string; status: string }[] = [], public conditions: Condition[] = [], public approvers: Approvers = { A: [], B: [], C: [] }) {}
  calls: string[] = [];
  async loadRequests() { return this.requests.map((r) => ({ ...r })); }
  async myGates() { return [...this.can]; }
  async loadDocs() { return [...this.docs]; }
  async requestGate(gate: GateId, items: { item: string; ready: boolean; criteria: ChecklistItem[] }[]) {
    this.calls.push(`request ${gate} ${items.length}`);
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
  async move(itemId: string, to: string) {
    this.calls.push(`move ${itemId} ${to}`);
    if (this.failMove) return { ok: false as const, error: this.failMove };
    this.onMove?.(itemId, to);
    return { ok: true as const };
  }
  async loadConditions(itemId: string) { return this.conditions.filter((c) => c.item_id === itemId); }
  async doneCondition(id: string) { const c = this.conditions.find((x) => x.id === id); if (c) c.done_at = "2026-11-05T12:00:00Z"; return { ok: true as const }; }
  items: GateItem[] = [];
  deciders: Decider[] = [];
  async loadItems(ids: string[]) { return this.items.filter((i) => ids.includes(i.id)); }
  async loadDeciders() { return [...this.deciders]; }
  async loadApprovers() { return { A: [...this.approvers.A], B: [...this.approvers.B], C: [...this.approvers.C] }; }
  async resumeSync(itemId: string) { this.calls.push(`resume ${itemId}`); return { ok: true as const }; }
  async setApprovers(gate: GateId, userIds: string[]) { this.approvers[gate] = [...userIds]; return { ok: true as const }; }
}
