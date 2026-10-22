import { notFound } from "next/navigation";
import { HarnessGantt } from "./harness";

/** Test page for the Gantt with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function GanttHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessGantt n={Number(q.n ?? 40)} role={q.role ?? "creator"} />;
}
