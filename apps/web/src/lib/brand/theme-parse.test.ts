import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseThemeXml, readTheme } from "./theme-parse";

const THEME = `<?xml version="1.0"?><a:theme xmlns:a="x" name="Acme"><a:themeElements><a:clrScheme name="Acme palette">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>
<a:accent1><a:srgbClr val="0B6E4F"/></a:accent1><a:accent2><a:srgbClr val="F59E0B"/></a:accent2><a:accent3><a:srgbClr val="2270ED"/></a:accent3>
<a:accent4><a:srgbClr val="D00000"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6>
<a:hlink><a:srgbClr val="1A56C4"/></a:hlink><a:folHlink><a:srgbClr val="6B7280"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Acme fonts"><a:majorFont><a:latin typeface="Fraunces"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="IBM Plex Sans"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

async function file(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [k, v] of Object.entries(parts)) z.file(k, v);
  return z.generateAsync({ type: "uint8array" });
}

describe("theme files", () => {
  it("reads the colours and fonts of a theme", () => {
    const t = parseThemeXml(THEME);
    expect(t.name).toBe("Acme palette");
    expect(t.colors).toMatchObject({ dk1: "#000000", lt1: "#ffffff", dk2: "#1f2937", accent1: "#0b6e4f", accent2: "#f59e0b", accent6: "#0891b2", hlink: "#1a56c4" });
    expect(t.fonts).toEqual({ major: "Fraunces", minor: "IBM Plex Sans" });
  });

  it("reads a presentation, with the first picture on its slide master as the logo", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const bytes = await file({
      "ppt/theme/theme1.xml": THEME,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": png,
    });
    const r = await readTheme(bytes, "Brand template.potx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.theme.kind).toBe("pptx");
    expect(r.theme.colors.accent1).toBe("#0b6e4f");
    expect(r.theme.logo?.length).toBe(png.length);
  });

  it("reads a Word document's theme", async () => {
    const r = await readTheme(await file({ "word/theme/theme1.xml": THEME }), "Brand.docx");
    expect(r.ok && r.theme.kind).toBe("docx");
    expect(r.ok && r.theme.logo).toBeNull();
  });

  it("refuses macro-enabled files, other types, empty and broken files, and files without a theme, with a reason", async () => {
    const good = await file({ "ppt/theme/theme1.xml": THEME });
    expect((await readTheme(good, "x.pptm")).ok).toBe(false);
    expect((await readTheme(good, "x.potm")).ok).toBe(false);
    expect((await readTheme(good, "x.docm")).ok).toBe(false);
    expect((await readTheme(good, "x.pdf")).ok).toBe(false);
    expect((await readTheme(new Uint8Array(), "x.pptx")).ok).toBe(false);
    expect((await readTheme(Uint8Array.from([1, 2, 3, 4]), "x.pptx")).ok).toBe(false);
    expect((await readTheme(await file({ "ppt/other.xml": "<x/>" }), "x.pptx")).ok).toBe(false);
    const withMacro = await file({ "ppt/theme/theme1.xml": THEME, "ppt/vbaProject.bin": "binary" });
    const r = await readTheme(withMacro, "renamed.pptx");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("macros");
  });

  it("does not read an oversized theme part or a picture that is too big for a logo", async () => {
    const big = THEME.replace("</a:theme>", `<!--${"x".repeat(2 * 1024 * 1024 + 10)}--></a:theme>`);
    expect((await readTheme(await file({ "ppt/theme/theme1.xml": big }), "x.pptx")).ok).toBe(false);
    const r = await readTheme(await file({
      "ppt/theme/theme1.xml": THEME,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": '<Relationships><Relationship Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": new Uint8Array(1_000_100),
    }), "x.pptx");
    expect(r.ok && r.theme.logo).toBeNull();
  });
});
