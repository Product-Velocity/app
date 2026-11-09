import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let accountType: string | null = "Organization";
let listCalls = 0;
const connection = () => ({ id: "c1", tenant_id: "t1", state: "connected", installation_id: 9, account_login: "dev-nbm", account_type: accountType });
const query = (table: string) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: table === "github_connections" ? connection() : { is_service_account: false }, error: null });
  return q;
};
vi.mock("@/lib/session", () => ({ requireWorkspace: async () => ({ supabase: { from: query }, user: { id: "u1" }, active: { tenantId: "t1", role: "admin", platform: null } }) }));
vi.mock("@/lib/github/server", () => ({
  githubSourceControl: () => ({ listBoards: async () => { listCalls++; return [{ id: "b1", number: 1, title: "EARO delivery", url: "https://github.com/orgs/x/projects/1", closed: false }]; } }),
}));

const { listBoardChoices, loadBoardFields, saveBoardLink } = await import("./board-actions");
const { PERSONAL_ACCOUNT_NOTE } = await import("./shared");

beforeEach(() => { accountType = "Organization"; listCalls = 0; });

describe("project boards on a personal GitHub account (issue #364 follow-up)", () => {
  it("says plainly that boards need an organisation, and never asks GitHub", async () => {
    accountType = "User";
    expect(await listBoardChoices()).toEqual({ error: PERSONAL_ACCOUNT_NOTE });
    expect(await loadBoardFields("b1")).toEqual({ ok: false, error: PERSONAL_ACCOUNT_NOTE });
    expect(await saveBoardLink("p1", "b1", {})).toEqual({ error: PERSONAL_ACCOUNT_NOTE });
    expect(listCalls).toBe(0);
  });
  it("still lists an organisation's open Projects", async () => {
    expect(await listBoardChoices()).toMatchObject({ boards: [{ id: "b1", title: "EARO delivery" }] });
    expect(listCalls).toBe(1);
  });
  it("the note says what still works and what to do", () => {
    expect(PERSONAL_ACCOUNT_NOTE).toMatch(/organisation/i);
    expect(PERSONAL_ACCOUNT_NOTE).toMatch(/Issues, labels and Sync work/);
  });
});
