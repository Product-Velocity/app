import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let accountType: string | null = "Organization";
let listCalls = 0;
let lastKind: string | undefined;
let refuse = false;
const connection = () => ({ id: "c1", tenant_id: "t1", state: "connected", installation_id: 9, account_login: "dev-nbm", account_type: accountType });
const query = (table: string) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: table === "github_connections" ? connection() : { is_service_account: false }, error: null });
  return q;
};
vi.mock("@/lib/session", () => ({ requireWorkspace: async () => ({ supabase: { from: query }, user: { id: "u1" }, active: { tenantId: "t1", role: "admin", platform: null } }) }));
vi.mock("@/lib/github/server", () => ({
  githubSourceControl: () => ({ listBoards: async (_i: number, _o: string, kind?: string) => { listCalls++; lastKind = kind; if (refuse) throw Object.assign(new Error("refused"), { status: 403 }); return [{ id: "b1", number: 1, title: "EARO delivery", url: "https://github.com/orgs/x/projects/1", closed: false }]; } }),
}));

const { listBoardChoices, loadBoardFields, saveBoardLink } = await import("./board-actions");
const { PERSONAL_ACCOUNT_NOTE } = await import("./shared");

beforeEach(() => { accountType = "Organization"; listCalls = 0; lastKind = undefined; refuse = false; });

describe("project boards on a personal GitHub account (issue #364 follow-up)", () => {
  it("asks GitHub for the account's Projects as a user, and lists them when GitHub allows it", async () => {
    accountType = "User";
    expect(await listBoardChoices()).toMatchObject({ boards: [{ id: "b1" }] });
    expect(lastKind).toBe("User");
  });
  it("explains, instead of \"try again\", when GitHub does not give the App a personal account's Projects", async () => {
    accountType = "User"; refuse = true;
    expect(await listBoardChoices()).toEqual({ error: PERSONAL_ACCOUNT_NOTE });
    expect(await loadBoardFields("b1")).toEqual({ ok: false, error: PERSONAL_ACCOUNT_NOTE });
    expect(await saveBoardLink("p1", "b1", {})).toEqual({ error: PERSONAL_ACCOUNT_NOTE });
  });
  it("an organisation is looked up as an organisation, and its refusals keep their own wording", async () => {
    expect(await listBoardChoices()).toMatchObject({ boards: [{ id: "b1", title: "EARO delivery" }] });
    expect(lastKind).toBe("Organization");
    refuse = true;
    expect(await listBoardChoices()).toMatchObject({ error: expect.stringMatching(/Organization permission/) });
  });
  it("the note says what still works and what to do", () => {
    expect(PERSONAL_ACCOUNT_NOTE).toMatch(/organisation/i);
    expect(PERSONAL_ACCOUNT_NOTE).toMatch(/Issues, labels and Sync work/);
  });
});
