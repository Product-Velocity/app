"use client";

import { Loading } from "@/components/pill-loader";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { CardsView } from "./cards-view";
import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource } from "../gates/gate-source";
import { useIsPhone } from "../phone/use-is-phone";
import { PhoneInitiatives } from "../phone/phone-initiatives";

/** Loads every item of the workspace (as the grid does), then shows the cards. */
export function CardsClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups);
  const phone = useIsPhone();
  const gates = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>Cards</h1></div><Loading>Loading the roadmap…</Loading></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  if (phone) return <PhoneInitiatives controller={state.controller} lookups={lookups} me={userId} tenantId={tenantId} />;
  return <CardsView controller={state.controller} lookups={lookups} me={userId} gates={gates} />;
}
