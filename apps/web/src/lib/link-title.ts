import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * The title of a web page, so a pasted link can be named for the person (issue #325). The address is typed by a signed-in person but the
 * request leaves OUR server, so it must never reach our own network: only http(s) on the usual ports, no credentials in the address, every
 * address the name resolves to must be public (checked again at the moment of connecting, which defeats a name that changes its answer),
 * at most 3 redirects (each checked the same way), 4 seconds, 64 KB. Any failure answers null: a title is a convenience, never an error.
 */
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

/** Whether an IP address is one on the public internet (not loopback, private, link-local, shared, multicast, reserved or documentation space). */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // shared address space
    if (a === 169 && b === 254) return false; // link-local, including cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const g = expandV6(ip);
    if (!g) return false;
    const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff; // ::ffff:a.b.c.d
    if (mapped) return isPublicAddress(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
    if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return false; // :: and ::1
    const first = g[0]!;
    if ((first & 0xfe00) === 0xfc00) return false; // unique local
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
    if (first === 0x0064 && g[1] === 0xff9b) return false; // NAT64: can reach IPv4 space we cannot judge here
    if (first === 0x2002) return false; // 6to4
    return (first & 0xe000) === 0x2000; // only global unicast 2000::/3
  }
  return false;
}
function expandV6(ip: string): number[] | null {
  let s = ip.split("%")[0]!;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1]!.split(".").map(Number);
    s = s.slice(0, -v4[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ":" + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...t].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? parts : null;
}

/** The address as a URL we are willing to fetch, or null. */
export function allowedUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const port = u.port === "" ? (u.protocol === "https:" ? 443 : 80) : Number(u.port);
  if (port !== 80 && port !== 443) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : ""; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** The page's own name: og:title, else <title>. Plain text, one line, at most 200 characters. */
export function parseTitle(html: string): string | null {
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*>/i.exec(html)?.[0];
  const ogContent = og ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(og) : null;
  const raw = ogContent ? (ogContent[1] ?? ogContent[2] ?? "") : /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const text = decode(raw.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : null;
}

/** DNS answers are checked here, when the connection is made: a name that points at a private address is refused. */
const safeLookup = ((hostname: string, options: dns.LookupOptions, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) return cb(new Error("blocked address"));
    if (options.all) return cb(null, list);
    return cb(null, list[0]!.address, list[0]!.family);
  });
}) as unknown as net.LookupFunction;

function getOnce(u: URL): Promise<{ status: number; location: string | null; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "GET", lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "User-Agent": "ProductVelocityLinkTitle/1.0", Accept: "text/html", "Accept-Encoding": "identity" } }, (res) => {
      const type = String(res.headers["content-type"] ?? "");
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      if (status !== 200 || !/^text\/html|^application\/xhtml/i.test(type)) { res.destroy(); return resolve({ status, location, type, body: "" }); }
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => { chunks.push(c); n += c.length; if (n >= MAX_BYTES) res.destroy(); });
      const done = () => resolve({ status, location, type, body: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8") });
      res.on("end", done); res.on("close", done); res.on("error", done);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchLinkTitle(raw: string): Promise<string | null> {
  let u = allowedUrl(raw);
  try {
    for (let hop = 0; u && hop <= MAX_REDIRECTS; hop++) {
      const r = await getOnce(u);
      if (r.status >= 300 && r.status < 400 && r.location) { u = allowedUrl(new URL(r.location, u).toString()); continue; }
      return r.body ? parseTitle(r.body) : null;
    }
  } catch { /* a title is a convenience */ }
  return null;
}
