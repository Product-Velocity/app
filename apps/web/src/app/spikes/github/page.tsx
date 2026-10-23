import { requireWorkspace } from "@/lib/session";
import { SpikeConsole } from "./console";

// THROWAWAY page for issue #30. Admin-only; remove with the rest of the spike code.
// The checks make dozens of GitHub calls, so allow a long function run.
export const maxDuration = 60;

export default async function SpikePage() {
  const { active } = await requireWorkspace("/spikes/github");
  if (active.role !== "admin") return <main style={{ padding: 24 }}>Admins only.</main>;
  return (
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>GitHub sandbox spikes (#30)</h1>
      <p>
        Acts as the GitHub App on <code>Product-Velocity/Test-Repo-01</code> only. Throwaway: nothing here is the real
        sync.
      </p>
      <SpikeConsole />
    </main>
  );
}
