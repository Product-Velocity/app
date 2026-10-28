import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { auditCsv, parseAuditFilters } from "@/lib/audit-log";
import { EXPORT_LIMIT, loadAudit } from "@/lib/audit-query";

export const dynamic = "force-dynamic";

/** CSV of the audit log with the same filters as the page (R-111 FR-6.6). Admins of the account only; the database enforces it as well. */
export async function GET(request: NextRequest) {
  const { supabase, active } = await requireWorkspace("/settings/audit");
  if (active.role !== "admin" && !active.platform) return new NextResponse("Only workspace admins can export the audit log.", { status: 403 });
  const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
  const { rows, lookup } = await loadAudit(supabase, { tenantId: active.tenantId, filters, limit: EXPORT_LIMIT });
  lookup.accounts = { [active.tenantId]: active.tenantName };
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(auditCsv(rows, lookup), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${stamp}.csv"`, "cache-control": "no-store" },
  });
}
