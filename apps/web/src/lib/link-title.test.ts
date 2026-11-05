import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { allowedUrl, fetchLinkTitle, isPublicAddress, parseTitle } = await import("./link-title");

describe("isPublicAddress", () => {
  it("accepts public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("refuses loopback, private, link-local (cloud metadata), shared, multicast, reserved and mapped private addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
      "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "not an ip"]) expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe("allowedUrl", () => {
  it("takes http(s) on the usual ports and refuses the rest", () => {
    expect(allowedUrl("https://example.com/a?b=1")?.hostname).toBe("example.com");
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com", "https://example.com:8080", "http://localhost/", "http://127.0.0.1/", "http://[::1]/",
      "http://169.254.169.254/latest/meta-data", "http://intranet.internal/", "http://printer.local/", "not a url"]) expect(allowedUrl(bad), bad).toBeNull();
  });
});

describe("parseTitle", () => {
  it("reads og:title first, then <title>, as one line of plain text", () => {
    expect(parseTitle('<head><title>Fallback</title><meta property="og:title" content="Design &amp; spec"></head>')).toBe("Design & spec");
    expect(parseTitle("<title>\n  Roadmap   Q4 &#8211; Plan\n</title>")).toBe("Roadmap Q4 – Plan");
    expect(parseTitle("<p>no title</p>")).toBeNull();
    expect(parseTitle("<title>" + "x".repeat(500) + "</title>")).toHaveLength(200);
    expect(parseTitle("<title><b>Bold</b></title>")).toBe("Bold");
  });
});

describe("fetchLinkTitle", () => {
  it("never connects to our own machine, even through a public-looking redirect target", async () => {
    let hits = 0;
    const server = http.createServer((_, res) => { hits++; res.setHeader("content-type", "text/html"); res.end("<title>secret</title>"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      expect(await fetchLinkTitle(`http://127.0.0.1:${port}/`)).toBeNull();
      expect(await fetchLinkTitle(`http://localhost:${port}/`)).toBeNull();
      expect(hits).toBe(0);
    } finally { server.close(); }
  });
});
