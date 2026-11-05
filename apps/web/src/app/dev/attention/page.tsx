import { notFound } from "next/navigation";
import { HarnessAttention } from "./harness";

/** Test page for Needs attention with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function AttentionHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessAttention role={q.role ?? "creator"} />;
}
