import { notFound } from "next/navigation";
import { HarnessClient } from "./harness-client";

/** Test page for the roadmap grid with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function GridHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessClient n={Number(q.n ?? 200)} latency={Number(q.latency ?? 0)} role={q.role ?? "creator"} view={q.view} allColumns={q.cols === "all"} />;
}
