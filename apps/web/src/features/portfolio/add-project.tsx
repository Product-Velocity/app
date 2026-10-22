"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/** Admins add a project by name (the full project setup comes later). Items need a project, so quick-add depends on this. */
export function AddProject({ tenantId, open: startOpen = false }: { tenantId: string; open?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().from("projects").insert({ tenant_id: tenantId, name: n });
    setBusy(false);
    if (e) { setError(e.code === "23505" ? `There is already a project called "${n}".` : e.code === "42501" ? "Only admins can add projects." : e.message); return; }
    setName("");
    setOpen(false);
    router.refresh();
  };

  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>Add project</button>;
  return (
    <span className="add-project">
      <label>
        <span className="sr-only">Project name</span>
        <input
          autoFocus
          value={name}
          placeholder="Project name, then Enter"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); else if (e.key === "Escape") { setOpen(false); setName(""); setError(null); } }}
        />
      </label>
      {error && <span role="alert" className="quick-add-error"> {error}</span>}
    </span>
  );
}
