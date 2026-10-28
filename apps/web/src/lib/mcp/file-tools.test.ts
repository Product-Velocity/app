import { describe, expect, it, vi } from "vitest";
import type { FileRepo, SearchRow, UsageResult } from "@pv/domain";
import { buildContext, type FileInfo, type ItemDetail } from "./read-model";
import { handleRpc, TOOLS, type McpBackend } from "./rpc";
import { ToolInputError } from "./tool-error";
import type { McpFiles, StoredFile } from "./write-model";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const b64 = (b: Buffer) => b.toString("base64");

type Out = { result: { isError?: boolean; content: { text: string }[] } };
function setup(opts: { role?: string; existing?: number; repo?: FileRepo; files?: Record<string, StoredFile>; meter?: McpBackend["meter"] } = {}) {
  const stored: Record<string, StoredFile> = opts.files ?? { f1: { id: "f1", item_id: "i1", item_code: "R-01", name: "board.png", share_token: "tok" } };
  const added: { item: string; name: string; size: number; mime: string }[] = [];
  const files: McpFiles = {
    get: vi.fn(async (id) => stored[id] ?? null),
    add: vi.fn(async (item, name, bytes, mime): Promise<FileInfo> => {
      added.push({ item: item.code, name, size: bytes.length, mime });
      return { id: "new1", item_code: item.code, name, mime, size: bytes.length, shared: false, share_url: null };
    }),
    setSharing: vi.fn(async (_f, on) => (on ? "https://app.test/f/NEWTOKEN/board.png" : null)),
    remove: vi.fn(async () => undefined),
    repoFor: vi.fn(async () => opts.repo ?? { name: "acme/app", isPrivate: true }),
  };
  const meter = opts.meter ?? vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true }));
  const detail = (ref: string): ItemDetail | null =>
    ref.toUpperCase() === "R-01"
      ? ({ row: { id: "i1", item_code: "R-01" } as SearchRow, links: [], tags: {}, relations: { depends_on: [], depended_on_by: [], related_to: [] }, teams: [], files: Array.from({ length: opts.existing ?? 0 }, (_, n) => ({ id: `x${n}` })) as FileInfo[], github: null, activity: [] })
      : null;
  const role = opts.role ?? "creator";
  const backend: McpBackend = {
    role,
    workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role, projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
    read: { itemDetail: vi.fn(async (r: string) => detail(r)), searchData: vi.fn(), groups: vi.fn(), views: vi.fn(), files: vi.fn() } as never,
    write: { files } as never,
    meter,
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, backend, TOOLS)) as Out;
    const text = r.result.content[0]!.text;
    return { isError: r.result.isError === true, text, data: r.result.isError ? null : JSON.parse(text).data };
  };
  return { call, files, added, meter };
}

describe("add_file", () => {
  it("attaches a PNG, reading the type from the bytes, and says it is not shared yet", async () => {
    const s = setup();
    const r = await s.call("add_file", { item: "r-01", name: "board.png", content_base64: b64(PNG) });
    expect(r.data).toMatchObject({ status: "added", file: { id: "new1", item: "R-01", name: "board.png", type: "image/png", shared: false } });
    expect(s.added).toEqual([{ item: "R-01", name: "board.png", size: PNG.length, mime: "image/png" }]);
  });

  it("refuses SVG, HTML and a renamed script with a readable message, and stores nothing", async () => {
    const s = setup();
    for (const [name, body] of [["x.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'], ["page.html", "<html><script>1</script></html>"], ["evil.png", "#!/bin/sh\nrm -rf /"]] as const) {
      const r = await s.call("add_file", { item: "R-01", name, content_base64: Buffer.from(body).toString("base64") });
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toMatch(/Only PNG, JPEG, GIF, WebP and PDF/);
    }
    expect(s.files.add).not.toHaveBeenCalled();
  });

  it("refuses an 11 MB file, the 21st file, an empty file and bad base64", async () => {
    const s = setup({ existing: 20 });
    expect((await s.call("add_file", { item: "R-01", name: "a.png", content_base64: b64(PNG) })).text).toMatch(/at most 20 files/);
    const big = setup();
    const r = await big.call("add_file", { item: "R-01", name: "big.png", content_base64: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]).toString("base64") });
    expect(r.text).toMatch(/larger than 10 MB/);
    expect((await big.call("add_file", { item: "R-01", name: "a.png", content_base64: "%%%" })).text).toMatch(/not valid base64/);
    expect((await big.call("add_file", { item: "R-09", name: "a.png", content_base64: b64(PNG) })).text).toMatch(/No initiative "R-09"/);
    expect(big.files.add).not.toHaveBeenCalled();
  });

  it("counts the bytes against the daily limit and stops when the limit is reached", async () => {
    const meter = vi.fn<McpBackend["meter"]>(async () => ({ ok: true }));
    await setup({ meter }).call("add_file", { item: "R-01", name: "a.png", content_base64: b64(PNG) });
    const [items, bytes] = meter.mock.calls[0]!;
    expect(items).toBe(0);
    expect(bytes).toBeGreaterThanOrEqual(PNG.length - 2);
    const full = setup({ meter: vi.fn(async () => ({ ok: false as const, reason: "workspace_bytes", limit: 104857600, used: 104857600 })) });
    const r = await full.call("add_file", { item: "R-01", name: "a.png", content_base64: b64(PNG) });
    expect(r.text).toMatch(/100 MB of uploads/);
    expect(full.files.add).not.toHaveBeenCalled();
  });

  it("a read-only role cannot upload, and the refusal comes before anything is metered or stored", async () => {
    const s = setup({ role: "viewer" });
    const r = await s.call("add_file", { item: "R-01", name: "a.png", content_base64: b64(PNG) });
    expect(r.text).toMatch(/read-only/);
    expect(s.files.add).not.toHaveBeenCalled();
    expect(s.meter).not.toHaveBeenCalled();
  });

  it("shows a database refusal as a readable message", async () => {
    const s = setup();
    (s.files.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ToolInputError("You do not have permission to attach files here."));
    expect((await s.call("add_file", { item: "R-01", name: "a.png", content_base64: b64(PNG) })).text).toBe("You do not have permission to attach files here.");
  });
});

describe("set_file_sharing", () => {
  it("on, private repository: returns the link, says anyone can open it and that it is added on the next push", async () => {
    const r = await setup().call("set_file_sharing", { file: "f1", on: true });
    expect(r.data).toMatchObject({ status: "sharing_on", share_url: "https://app.test/f/NEWTOKEN/board.png", anyone_with_link_can_open: true, github: { repository_private: true } });
    expect(r.data.message).toMatch(/Anyone who has this link can open the file.*added to the GitHub issue on the next push/s);
  });

  it("on, public repository: the result carries the warning that the link is not written to the issue", async () => {
    const r = await setup({ repo: { name: "acme/open", isPrivate: false } }).call("set_file_sharing", { file: "f1", on: true });
    expect(r.data.message).toMatch(/Anyone who has this link.*PUBLIC repository.*will NOT be written/s);
    expect(r.data.github.link_written_to_issue).toMatch(/never/);
  });

  it("off: no link, and it says the address stopped working", async () => {
    const r = await setup().call("set_file_sharing", { file: "f1", on: false });
    expect(r.data).toMatchObject({ status: "sharing_off", share_url: null, anyone_with_link_can_open: false });
    expect(r.data.message).toMatch(/stopped working at once.*404/);
  });

  it("an unknown file id (another workspace's included: the reader finds nothing) is refused without naming anything", async () => {
    const s = setup();
    const r = await s.call("set_file_sharing", { file: "someone-elses", on: true });
    expect(r.isError).toBe(true);
    expect(s.files.setSharing).not.toHaveBeenCalled();
    expect((await s.call("set_file_sharing", { file: "f1" })).text).toMatch(/on \(true\) or off \(false\)/);
  });

  it("is refused for a read-only role", async () => {
    const s = setup({ role: "viewer" });
    expect((await s.call("set_file_sharing", { file: "f1", on: true })).text).toMatch(/read-only/);
    expect(s.files.setSharing).not.toHaveBeenCalled();
  });
});

describe("remove_file", () => {
  it("asks for confirmation first and removes nothing", async () => {
    const s = setup();
    const r = await s.call("remove_file", { file: "f1" });
    expect(r.data).toMatchObject({ status: "needs_confirmation", nothing_changed: true });
    expect(r.data.ask).toMatch(/share link stops working/);
    expect(s.files.remove).not.toHaveBeenCalled();
    expect((await s.call("remove_file", { file: "f1", confirm: "yes" })).data.status).toBe("needs_confirmation");
  });

  it("removes with confirm=true", async () => {
    const s = setup();
    expect((await s.call("remove_file", { file: "f1", confirm: true })).data).toMatchObject({ status: "removed", file: { name: "board.png" } });
    expect(s.files.remove).toHaveBeenCalledOnce();
  });

  it("is refused for a read-only role and for an unknown file", async () => {
    expect((await setup({ role: "viewer" }).call("remove_file", { file: "f1", confirm: true })).text).toMatch(/read-only/);
    const s = setup();
    expect((await s.call("remove_file", { file: "nope", confirm: true })).isError).toBe(true);
    expect(s.files.remove).not.toHaveBeenCalled();
  });
});
