import { notFound } from "next/navigation";
import { HarnessReports } from "./harness";

/** Test page for the Reports tab with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function ReportsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessReports n={Number(q.n ?? 42)} role={q.role ?? "creator"} />;
}
