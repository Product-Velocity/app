import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { CONNECT_CARDS } from "@/lib/onboarding";
import { Wizard } from "../wizard";

export const metadata = { title: "Connect your tools · Product Velocity" };

/** The last step: the workspace is ready. Connecting is optional and each card opens its own settings screen. */
export default async function ConnectPage() {
  const { active } = await requireWorkspace("/onboarding/connect");
  if (active.isDemoAccount || active.platform || active.role !== "admin") redirect("/portfolio");
  return (
    <Wizard step="connect" title={`${active.tenantName} is ready`} intro="Connect the tools you use now, or later: the Get started card on your roadmap keeps these within reach.">
      <ul className="connect-cards">
        {CONNECT_CARDS.map((c) => (
          <li key={c.key}>
            <div><strong>{c.title}</strong><br /><span className="muted">{c.text}</span></div>
            <Link className="btn btn-sm" href={c.href}>{c.key === "claude" ? "Set up" : `Connect ${c.title}`}</Link>
          </li>
        ))}
      </ul>
      <p className="hint">Need help? <Link href="/help" target="_blank">Read the Help pages</Link> or <Link href="/contact" target="_blank">send us a question</Link>.</p>
      <div className="wizard-actions"><Link className="btn btn-primary" href="/portfolio">Open my roadmap</Link></div>
    </Wizard>
  );
}
