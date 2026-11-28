import { describe, expect, it } from "vitest";
import { isBrandish, parseWebsite } from "./detect-website";

const HTML = `<!doctype html><html><head><title>Acme Media | Streaming that fits</title>
<meta name="theme-color" content="#0b6e4f"><meta property="og:image" content="/img/share.png">
<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=IBM+Plex+Sans" rel="stylesheet">
<style>:root{--brand-primary:#0B6E4F;--accent:#f59e0b;--text:#111;--bg:#fff} body{font-family:"IBM Plex Sans",Arial,sans-serif;color:#111} h1{font-family:Fraunces,serif;color:#0b6e4f} a{color:#0b6e4f} .btn{background:#f59e0b} .x{color:#888;background:#eee}</style></head>
<body><header><a href="/"><img class="site-logo" alt="Acme" src="/assets/logo.svg"></a></header><img src="/photo.jpg" alt="team"></body></html>`;

describe("website brand detection", () => {
  const p = parseWebsite({ html: HTML, css: "", base: "https://www.acme.example/home" });
  it("names the company from the title, without the tagline", () => { expect(p.name).toBe("Acme Media"); });
  it("finds the brand colours, named variables first, and ignores greys, white and black", () => {
    expect(p.colors[0]).toBe("#0b6e4f");
    expect(p.colors).toContain("#f59e0b");
    expect(p.colors.every(isBrandish)).toBe(true);
    expect(p.colors).not.toContain("#111111");
    expect(p.colors).not.toContain("#888888");
  });
  it("finds the fonts, by use, leaving out generic ones", () => { expect(p.fonts).toEqual(expect.arrayContaining(["IBM Plex Sans", "Fraunces"])); expect(p.fonts).not.toContain("Arial"); });
  it("lists logo candidates best first as absolute addresses: the marked logo, then icons, then the share image", () => {
    expect(p.logoCandidates).toEqual(["https://www.acme.example/assets/logo.svg", "https://www.acme.example/apple-180.png", "https://www.acme.example/favicon-32.png", "https://www.acme.example/img/share.png"]);
  });
  it("says so when nothing stands out, and only ever returns hex colours and plain addresses", () => {
    const q = parseWebsite({ html: "<html><head><title>Plain</title></head><body style=\"color:#222\"><img src=\"javascript:alert(1)\" class=\"logo\"></body></html>", css: "", base: "https://a.example/" });
    expect(q.colors).toEqual([]);
    expect(q.notes.join(" ")).toContain("No brand colour");
    expect(q.logoCandidates).toEqual([]);
  });
  it("takes colours from a stylesheet too, and from rgb()", () => {
    const q = parseWebsite({ html: "<html></html>", css: ".a{background:rgb(34,112,237)} .b{background:rgb(34,112,237)} .c{color:#d00000}", base: "https://a.example/" });
    expect(q.colors[0]).toBe("#2270ed");
  });
});
