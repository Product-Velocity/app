import { NextResponse, type NextRequest } from "next/server";
import { authenticate, mcpEnabled } from "@/lib/mcp/auth";
import { handleRpc, parseBearer, wwwAuthenticate } from "@/lib/mcp/rpc";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, init);

/** Streamable HTTP MCP endpoint (stateless, JSON responses). */
export async function POST(req: NextRequest) {
  if (!mcpEnabled()) return new NextResponse("Not found", { status: 404 });

  const token = parseBearer(req.headers.get("authorization"));
  const caller = token ? await authenticate(token) : null;
  if (!caller) {
    return json(
      { error: "invalid_token", error_description: "Sign in again: this connection is missing, expired or revoked." },
      { status: 401, headers: { "WWW-Authenticate": wwwAuthenticate(await siteUrl()) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || (m as { jsonrpc?: string }).jsonrpc !== "2.0") {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
    }
    const r = await handleRpc(m as Parameters<typeof handleRpc>[0], caller.backend);
    if (r) out.push(r);
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return json(Array.isArray(body) ? out : out[0]);
}

/** No server-initiated stream in this spike. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
