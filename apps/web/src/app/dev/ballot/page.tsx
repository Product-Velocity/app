import { notFound } from "next/navigation";
import { BallotHarness } from "./harness";

/** Test page for the participant ballot with in-memory answers. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function BallotTestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <BallotHarness method={q.method ?? "coins"} n={Number(q.n ?? 6)} />;
}
