import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubAppSourceControl } from "./index";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("GitHubAppSourceControl: the read-only catalog calls", () => {
  const sc = (routes: Record<string, Response>) => new GitHubAppSourceControl({ appId: "1", privateKeyPem: privateKey, fetch: (async (url: string) => (url.endsWith("/access_tokens") ? new Response(JSON.stringify({ token: "t" }), { status: 201 }) : (Object.entries(routes).find(([k]) => url.includes(k))?.[1].clone() ?? new Response("[]", { status: 200 })))) as typeof fetch });
  it("reads organisation issue fields, and returns null when the App lacks the permission (docs/08 S3b)", async () => {
    const ok = sc({ "/issue-fields": new Response(JSON.stringify([{ id: 7, node_id: "IF_7", name: "Priority", data_type: "single_select", options: [{ name: "Urgent" }, { name: 3 }] }, { id: 8, name: "Weird", data_type: "multi" }]), { status: 200 }) });
    expect(await ok.listIssueFields(1, "Acme")).toEqual([{ id: "IF_7", name: "Priority", dataType: "single_select", options: ["Urgent"] }, { id: "8", name: "Weird", dataType: "other", options: [] }]);
    expect(await sc({ "/issue-fields": new Response("{}", { status: 403 }) }).listIssueFields(1, "Acme")).toBeNull();
  });
  it("reads labels and milestones, an unknown repository gives nothing", async () => {
    const s = sc({ "/labels": new Response(JSON.stringify([{ name: "pv:moscow/must", description: "x" }, { name: "bug" }, {}]), { status: 200 }), "/milestones": new Response(JSON.stringify([{ title: "2026 Q4", due_on: "2026-12-31T12:00:00Z", state: "open" }]), { status: 200 }) });
    expect(await s.listLabels(1, "Acme/app")).toEqual([{ name: "pv:moscow/must", description: "x" }, { name: "bug", description: null }]);
    expect(await s.listMilestones(1, "Acme/app")).toEqual([{ title: "2026 Q4", dueOn: "2026-12-31T12:00:00Z", state: "open" }]);
    expect(await sc({ "/labels": new Response("{}", { status: 404 }) }).listLabels(1, "Acme/none")).toEqual([]);
  });
});
