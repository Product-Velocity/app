import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/session";
import { auditCsv, parseAuditFilters } from "@/lib/audit-log";
import { EXPORT_LIMIT, loadAudit } from "@/lib/audit-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase } = await requirePlatformAdmin("/platform/audit");
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const account = /^[0-9a-f-]{36}$/i.test(params.account ?? "") ? params.account : undefined;
  const { rows, lookup } = await loadAudit(supabase, { platform: true, tenantId: account, filters: parseAuditFilters(params), limit: EXPORT_LIMIT });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(auditCsv(rows, lookup), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-all-accounts-${stamp}.csv"`, "cache-control": "no-store" },
  });
}
