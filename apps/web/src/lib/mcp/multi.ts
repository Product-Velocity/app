/**
 * One Claude connection that covers several workspaces (R-114; docs/20 FR-1 and docs/05). Pure: the route builds one backend per
 * workspace the database said is ok, and this layer picks the right one for each call.
 *
 * - One workspace: nothing changes (no `workspace` argument anywhere).
 * - Several: every tool takes `workspace`. Without it the call is refused with a message that makes Claude ask the person; the
 *   server never guesses and never uses a default. `get_workspace_context` without it lists the workspaces and the role in each.
 * - A write in a different workspace than the last write of this connection (within two hours) is refused once, until the person
 *   has confirmed it and Claude repeats the call with `confirm_workspace: true`.
 * - Results say which workspace they come from.
 */
import { claudeAllowances, multiWorkspaceInstructions } from "@pv/domain";
import { DATA_ENVELOPE, DATA_NOTE, handleRpc, TOOLS, type McpBackend, type ToolDef } from "./rpc";

export type WorkspaceHandle = {
  id: string;
  name: string;
  role: string;
  /** When this connection last wrote in this workspace, as the database recorded it. */
  lastWriteAt: string | null;
  backend: McpBackend;
};
export type Unavailable = { name: string; status: string };
export const SWITCH_WINDOW_MS = 2 * 60 * 60 * 1000;

type Rpc = Parameters<typeof handleRpc>[0];
type RpcOut = NonNullable<Awaited<ReturnType<typeof handleRpc>>>;

const REASON: Record<string, string> = {
  workspace_off: "Claude is switched off there",
  not_member: "you are no longer a member",
  single_only: "its admins allow Claude there only on its own",
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const toolError = (id: RpcOut["id"], message: string): RpcOut => ({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: message }] } } as RpcOut);
const quoted = (hs: readonly WorkspaceHandle[]) => hs.map((h) => `"${h.name}" (${h.role})`).join(", ");

const notInConnection = (ref: string, handles: readonly WorkspaceHandle[], unavailable: readonly Unavailable[]) =>
  `No workspace "${ref}" in this connection. It covers: ${quoted(handles)}.${unavailable.length > 0 ? ` Not available: ${unavailable.map((u) => `"${u.name}" (${REASON[u.status] ?? "not available"})`).join(", ")}.` : ""} Nothing was done.`;

function pick(handles: readonly WorkspaceHandle[], ref: string): WorkspaceHandle | null {
  const want = ref.toLowerCase();
  return handles.find((h) => h.id === ref) ?? handles.find((h) => h.name.toLowerCase() === want) ?? null;
}

/** The workspace argument and the confirmation flag, added to every tool's schema when the connection covers several workspaces. */
function withWorkspace(tool: Record<string, unknown>, handles: readonly WorkspaceHandle[], write: boolean) {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  const properties = {
    ...schema.properties,
    workspace: { type: "string", description: `The workspace this call is for, by name: ${handles.map((h) => `"${h.name}"`).join(", ")}. Ask the person if they have not said.` },
    ...(write ? { confirm_workspace: { type: "boolean", description: "Set true only after the person confirmed that this is the workspace they mean, when the call came back asking you to confirm because your last change was in another workspace." } } : {}),
  };
  return { ...tool, inputSchema: { ...schema, properties } };
}

export async function handleMulti(msg: Rpc, handles: readonly WorkspaceHandle[], unavailable: readonly Unavailable[] = [], tools: ToolDef[] = TOOLS): Promise<RpcOut | null> {
  if (handles.length === 0) throw new Error("no workspace");
  if (handles.length === 1) {
    // Claude may still name a workspace it saw earlier (before another one became unavailable): a call meant for a workspace that is no
    // longer part of the connection must never run in the one that is left.
    const only = handles[0]!;
    const given = msg.method === "tools/call" ? text((msg.params?.arguments as Record<string, unknown> | undefined)?.workspace) : "";
    if (given && !pick(handles, given)) return toolError(msg.id ?? null, notInConnection(given, handles, unavailable));
    if (msg.method === "tools/call" && msg.params?.arguments && typeof msg.params.arguments === "object") {
      const rest = { ...(msg.params.arguments as Record<string, unknown>) };
      delete rest.workspace;
      delete rest.confirm_workspace;
      return handleRpc({ ...msg, params: { ...msg.params, arguments: rest } }, only.backend, tools);
    }
    return handleRpc(msg, only.backend, tools);
  }
  const first = handles[0]!.backend;
  const id = msg.id ?? null;

  switch (msg.method) {
    case "initialize": {
      const r = await handleRpc(msg, first, tools);
      const result = (r as { result?: { instructions?: string } } | null)?.result;
      if (result) result.instructions = `${result.instructions ?? ""}\n${multiWorkspaceInstructions(handles.map((h) => h.name))}`;
      return r;
    }
    case "tools/list": {
      const r = await handleRpc(msg, first, tools);
      const out = (r as { result?: { tools: Record<string, unknown>[] } } | null)?.result;
      if (out) {
        const write = new Set(tools.filter((t) => t.mode === "write").map((t) => t.name));
        out.tools = out.tools.map((t) => withWorkspace(t, handles, write.has(String(t.name))));
      }
      return r;
    }
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return handleRpc(msg, first, tools); // the unknown-tool answer
      const args = { ...((msg.params?.arguments ?? {}) as Record<string, unknown>) };
      const ref = text(args.workspace);
      const confirm = args.confirm_workspace === true;
      delete args.workspace;
      delete args.confirm_workspace;

      if (!ref) {
        if (tool.name === "get_workspace_context") {
          const data = {
            workspaces: handles.map((h) => ({ name: h.name, id: h.id, your_role: h.role, ...claudeAllowances(h.role), last_change_by_claude: h.lastWriteAt })),
            unavailable: unavailable.map((u) => ({ name: u.name, why: REASON[u.status] ?? "not available" })),
            notes: ["Pass workspace (the name) on every other call. Call get_workspace_context with a workspace for its projects, groups, teams and members."],
          };
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ envelope: DATA_ENVELOPE, note: DATA_NOTE, data }) }] } } as RpcOut;
        }
        return toolError(id, `This connection covers ${handles.length} workspaces: ${quoted(handles)}. Which workspace is this for? Ask the person if they have not said, then repeat the call with workspace set to its name.`);
      }
      const h = pick(handles, ref);
      if (!h) return toolError(id, notInConnection(ref, handles, unavailable));

      if (tool.mode === "write" && !confirm) {
        const now = Date.now();
        const newest = handles
          .filter((x) => x.lastWriteAt && now - Date.parse(x.lastWriteAt) < SWITCH_WINDOW_MS)
          .sort((a, b) => Date.parse(b.lastWriteAt!) - Date.parse(a.lastWriteAt!))[0];
        if (newest && newest.id !== h.id) {
          return toolError(id, `Your last change in this connection was in "${newest.name}". This call would change "${h.name}". Nothing was changed. Ask the person to confirm they mean "${h.name}", and only after they say yes repeat the call with confirm_workspace set to true.`);
        }
      }

      const r = await handleRpc({ ...msg, params: { ...msg.params, arguments: args } }, h.backend, tools);
      const res = (r as { result?: { isError?: boolean; content?: { type: string; text: string }[] } } | null)?.result;
      const block = res?.content?.[0];
      if (res && block) {
        if (res.isError) block.text = `[${h.name}] ${block.text}`;
        else {
          try {
            block.text = JSON.stringify({ ...JSON.parse(block.text), workspace: h.name });
          } catch {
            /* not our JSON: leave it as it is */
          }
        }
      }
      return r;
    }
    default:
      return handleRpc(msg, first, tools);
  }
}
