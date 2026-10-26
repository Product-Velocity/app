import { toCsv } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { computeResults, finalResults } from "@/lib/alignment-results";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The results as a CSV (admins only): aggregates, never names, addresses or groups under the threshold. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("not found", { status: 404 });
  const { supabase, active } = await requireWorkspace(`/alignment/${id}/results`);
  if (active.role !== "admin") return new Response("forbidden", { status: 403 });
  const { data: s } = await supabase.from("alignment_sessions").select("name, status").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!s || s.status === "draft") return new Response("not found", { status: 404 });
  const final = s.status === "closed" || s.status === "archived";
  const snap = final ? await finalResults(id) : await computeResults(createAdminClient({ via: "system" }), id);
  if (!snap) return new Response("not found", { status: 404 });
  const names = new Map(snap.items.map((i) => [i.id, i.name]));
  const contested = new Map(snap.results.contested.map((c) => [c.itemId, c]));
  const groups = snap.results.groups ?? [];
  const rows: (string | number | boolean)[][] = [
    ["Place", "Tied", "Initiative", "Score (top = 100)", "Contested", ...groups.map((g) => `${g.name} place (n=${g.voters})`)],
    ...snap.results.joint.map((p) => [p.place, p.tied, names.get(p.itemId) ?? "", p.score, contested.has(p.itemId), ...groups.map((g) => g.scores.find((x) => x.itemId === p.itemId)?.place ?? "")]),
    [],
    ["Voters", snap.voters, "Invited", snap.invited, final ? "Final" : "Provisional"],
  ];
  const file = `${s.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "results"}.csv`;
  return new Response("﻿" + toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store" } });
}
