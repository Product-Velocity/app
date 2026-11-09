import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { shareToDraft } from "@/features/phone/share";

export const metadata = { title: "Share · Product Velocity" };

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Where the phone's share sheet lands: sign in if needed (keeping what was shared), then open quick add prefilled. Nothing is created yet. */
export default async function SharePage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const here = new URLSearchParams();
  for (const k of ["title", "text", "url"]) { const v = one(q[k]); if (v) here.set(k, v.slice(0, 4000)); }
  await requireWorkspace(`/share?${here.toString()}`);
  const d = shareToDraft({ title: one(q.title), text: one(q.text), url: one(q.url) });
  const to = new URLSearchParams();
  if (d.name) to.set("name", d.name);
  if (d.line) to.set("line", d.line);
  redirect(`/new${to.size > 0 ? `?${to.toString()}` : ""}`);
}
