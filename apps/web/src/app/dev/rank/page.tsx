import { notFound } from "next/navigation";
import { HarnessRank } from "./harness";

/** Test page for the suggested order of an alignment result, with fictional data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default function RankHarness() {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  return <HarnessRank />;
}
