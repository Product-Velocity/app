import { notFound } from "next/navigation";
import { HarnessDecisions } from "./harness";

/** Test page for the Decisions screen with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function DecisionsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessDecisions can={q.can ?? "A,B,C"} />;
}
