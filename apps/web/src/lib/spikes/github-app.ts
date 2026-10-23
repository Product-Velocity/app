// THROWAWAY spike code for issue #30 (S2b, S3b, S4b, S5b). Delete when the spikes are recorded in docs/08.
// Acts as the GitHub App and only ever touches the sandbox org and repo below.
import "server-only";
import { createHmac, createSign, timingSafeEqual } from "node:crypto";

export const SANDBOX_ORG = "Product-Velocity";
export const SANDBOX_REPO = "Test-Repo-01";
const API = "https://api.github.com";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Short-lived App JWT (RS256), used only to list installations and mint installation tokens. */
export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const key = Buffer.from(env("GITHUB_APP_PRIVATE_KEY_B64"), "base64").toString("utf8");
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env("GITHUB_APP_ID") }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${b64url(sig)}`;
}

/** Valid only for the sandbox: other paths are refused so a typo cannot touch Product-Velocity/app. */
export function isSandboxPath(path: string): boolean {
  if (path === "/graphql") return true;
  if (path === "/app" || path === "/app/installations" || path.startsWith("/app/hook/deliveries")) return true;
  return (
    path.startsWith(`/repos/${SANDBOX_ORG}/${SANDBOX_REPO}/`) ||
    path === `/repos/${SANDBOX_ORG}/${SANDBOX_REPO}` ||
    path.startsWith(`/orgs/${SANDBOX_ORG}/`) ||
    path.startsWith(`/organizations/`)
  );
}

export type CallResult = { status: number; ok: boolean; headers: Record<string, string>; body: unknown };

export async function gh(
  auth: "app" | "installation",
  method: string,
  path: string,
  body?: unknown,
  installationToken?: string,
): Promise<CallResult> {
  if (!isSandboxPath(path)) throw new Error(`Path not allowed in the sandbox: ${path}`);
  const token = auth === "app" ? appJwt() : (installationToken ?? (await installationAccessToken()));
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "product-velocity-spike",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  const keep = ["x-accepted-github-permissions", "x-github-media-type", "x-ratelimit-remaining", "x-oauth-scopes"];
  const headers: Record<string, string> = {};
  for (const k of keep) {
    const v = res.headers.get(k);
    if (v) headers[k] = v;
  }
  return { status: res.status, ok: res.ok, headers, body: parsed };
}

/** Installation token for the org installation (never returned to the browser). */
export async function installationAccessToken(): Promise<string> {
  const inst = await gh("app", "GET", `/app/installations`);
  const list = Array.isArray(inst.body) ? (inst.body as { id: number; account?: { login?: string } }[]) : [];
  const mine = list.find((i) => i.account?.login?.toLowerCase() === SANDBOX_ORG.toLowerCase());
  if (!mine) throw new Error(`The App is not installed on ${SANDBOX_ORG} (installations seen: ${list.length})`);
  const res = await fetch(`${API}/app/installations/${mine.id}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appJwt()}`, Accept: "application/vnd.github+json", "User-Agent": "product-velocity-spike" },
    cache: "no-store",
  });
  const j = (await res.json()) as { token?: string; message?: string };
  if (!j.token) throw new Error(`Could not create installation token: ${res.status} ${j.message ?? ""}`);
  return j.token;
}

/** Constant-time check of GitHub's X-Hub-Signature-256 header. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
