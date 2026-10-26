import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { NamesForm } from "./names-form";

export const metadata = { title: "Who voted what · Product Velocity" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NamesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, active } = await requireWorkspace(`/alignment/${id}/names`);
  if (active.role !== "admin") notFound();
  const { data: s } = await supabase.from("alignment_sessions").select("id, name").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!s) notFound();
  return (
    <div className="page-wide">
      <p><Link href={`/alignment/${id}/results`}>← Results</Link></p>
      <h1>Who voted what</h1>
      <p className="notice">Participants were told that workspace admins can see who gave which answers. Each time you open this list, your name, the time and your reason are written to the audit log, where other admins can read them. The list is in the order people joined, not ranked.</p>
      <NamesForm sessionId={s.id} />
    </div>
  );
}
