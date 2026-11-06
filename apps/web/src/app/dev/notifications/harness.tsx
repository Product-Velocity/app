"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppNotification } from "@pv/domain";
import { NotificationsBell } from "@/features/notifications/notifications-bell";
import { MemoryNotificationSource } from "@/features/notifications/notification-source";

const note = (id: string, o: Partial<AppNotification> & { payload: AppNotification["payload"] }): AppNotification => ({ id, kind: "gate_requested", item_id: `item-${id}`, review_id: `r-${id}`, created_at: "2027-04-14T09:00:00Z", read_at: null, ...o });

/** Three notices: a request waiting, a decision (fast lane) and an older, already read withdrawal. */
export function HarnessNotifications({ empty }: { empty: boolean }) {
  const source = useMemo(() => new MemoryNotificationSource(empty ? [] : [
    note("1", { created_at: "2027-04-14T10:30:00Z", payload: { gate: "B", item_code: "R-12", item_name: "New checkout flow" } }),
    note("2", { kind: "gate_decided", created_at: "2027-04-14T08:00:00Z", payload: { gate: "A", item_code: "R-03", item_name: "Faster onboarding", outcome: "go", fast_lane: true } }),
    note("3", { kind: "gate_withdrawn", created_at: "2027-04-12T08:00:00Z", read_at: "2027-04-12T09:00:00Z", payload: { gate: "C", item_code: "R-07", item_name: "Referral programme" } }),
  ]), [empty]);
  const [opened, setOpened] = useState<string>("nothing");
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { source }; }, [source]);
  return (
    <div className="shell">
      <header className="topbar" style={{ justifyContent: "space-between" }}><span>Test page</span><NotificationsBell source={source} onOpen={(t) => setOpened(t ? (t.kind === "item" ? `item ${t.code}` : t.kind) : "nowhere")} /></header>
      <main className="content"><h1>Notifications (test page)</h1><p data-testid="opened">Opened: {opened}</p></main>
    </div>
  );
}
