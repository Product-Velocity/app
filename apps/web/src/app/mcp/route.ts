import { NextResponse, type NextRequest } from "next/server";
import { authenticate, mcpEnabled } from "@/lib/mcp/auth";
import { handleMulti } from "@/lib/mcp/multi";
import { parseBearer, toolsFor, wwwAuthenticate } from "@/lib/mcp/rpc";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, init);

/** The model an assistant states in a tool call (`ai_model`), if any: advisory text, cleaned and cut again by the database. */
function statedModel(body: unknown): string | null {
  for (const m of Array.isArray(body) ? body : [body]) {
    const a = (m as { method?: string; params?: { arguments?: { ai_model?: unknown } } } | null)?.params?.arguments?.ai_model;
    if (typeof a === "string" && a.trim()) return a;
  }
  return null;
}

/** Streamable HTTP MCP endpoint (stateless, JSON responses). */
export async function POST(req: NextRequest) {
  if (!mcpEnabled()) return new NextResponse("Not found", { status: 404 });

  const token = parseBearer(req.headers.get("authorization"));
  // read the body first so the model the assistant states (argument ai_model of a tool call) can be recorded on the audit rows of that call
  const raw = await req.text();
  let body: unknown;
  let parsed = true;
  try {
    body = JSON.parse(raw);
  } catch {
    parsed = false;
  }
  const auth = token ? await authenticate(token, req.headers.get("user-agent"), statedModel(body)) : null;
  if (!auth || !auth.ok) {
    const f = auth ?? { http: 401 as const, error: "invalid_token", message: "Sign in again: this connection is missing, expired or revoked." };
    return json(
      { error: f.error, error_description: f.message },
      { status: f.http, ...(f.http === 401 ? { headers: { "WWW-Authenticate": wwwAuthenticate(await siteUrl()) } } : {}) },
    );
  }
  const { caller } = auth;

  if (!parsed) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const tools = toolsFor(caller.assistant);
  const messages = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || (m as { jsonrpc?: string }).jsonrpc !== "2.0") {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
    }
    const r = await handleMulti(m as Parameters<typeof handleMulti>[0], caller.workspaces, caller.unavailable, tools);
    if (r) out.push(r);
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return json(Array.isArray(body) ? out : out[0]);
}

/** No server-initiated stream in this spike. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
