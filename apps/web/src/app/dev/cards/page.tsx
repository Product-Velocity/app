import { notFound } from "next/navigation";
import { HarnessCards } from "./harness";

/** Test page for the cards with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function CardsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessCards n={Number(q.n ?? 40)} role={q.role ?? "creator"} />;
}
