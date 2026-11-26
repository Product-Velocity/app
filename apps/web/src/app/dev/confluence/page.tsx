import { notFound } from "next/navigation";
import { ConfluenceHarness } from "./harness";

/** Test page for the Publish to Confluence dialog (the calls to the server are faked in the browser by the test). Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default function ConfluenceTestPage() {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  return <ConfluenceHarness />;
}
