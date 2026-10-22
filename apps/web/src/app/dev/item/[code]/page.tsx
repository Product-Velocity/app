import { notFound } from "next/navigation";
import { HarnessItem } from "./harness";

/** Test page for the item page with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function ItemHarness({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const { code } = await params;
  const q = await searchParams;
  return <HarnessItem code={decodeURIComponent(code)} role={q.role ?? "creator"} />;
}
