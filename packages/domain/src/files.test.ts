import { describe, expect, it } from "vitest";
import { ALLOWED_FILE_TYPES, canLinkFilesInto, fileKindOf, formatBytes, MAX_FILE_BYTES, MAX_FILES_PER_ITEM, safeFileName, sniffFileType, validateUpload } from "./files";

const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(32).fill(0)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);

describe("sniffFileType reads what the bytes are, not what the name or the browser says", () => {
  it("recognises the five allowed types", () => {
    expect(sniffFileType(PNG)).toBe("image/png");
    expect(sniffFileType(JPG)).toBe("image/jpeg");
    expect(sniffFileType(GIF)).toBe("image/gif");
    expect(sniffFileType(WEBP)).toBe("image/webp");
    expect(sniffFileType(PDF)).toBe("application/pdf");
  });
  it("refuses everything else: scripts, SVG, HTML, executables, empty", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sniffFileType(text("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(sniffFileType(text("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFileType(text("MZ\u0090\u0000"))).toBeNull();
    expect(sniffFileType(new Uint8Array())).toBeNull();
  });
});

describe("validateUpload", () => {
  const ok = { name: "mockup.png", bytes: PNG, size: 20_000, declaredType: "image/png", existingCount: 3 };
  it("accepts a normal image and returns the real type", () => {
    expect(validateUpload(ok)).toEqual({ ok: true, mime: "image/png", name: "mockup.png" });
  });
  it("says why in words: too big, too many, wrong type, empty", () => {
    expect(validateUpload({ ...ok, size: MAX_FILE_BYTES + 1 })).toEqual({ ok: false, error: "That file is larger than 10 MB." });
    expect(validateUpload({ ...ok, existingCount: MAX_FILES_PER_ITEM })).toEqual({ ok: false, error: "An initiative can have at most 20 files. Remove one first." });
    expect(validateUpload({ ...ok, bytes: new TextEncoder().encode("<svg/>"), declaredType: "image/svg+xml", name: "x.svg" })).toEqual({ ok: false, error: "Only PNG, JPEG, GIF, WebP and PDF files can be attached." });
    expect(validateUpload({ ...ok, size: 0, bytes: new Uint8Array() })).toEqual({ ok: false, error: "That file is empty." });
  });
  it("ignores a lying name or declared type: a PNG called .pdf is stored as a PNG", () => {
    expect(validateUpload({ ...ok, name: "invoice.pdf", declaredType: "application/pdf" })).toEqual({ ok: true, mime: "image/png", name: "invoice.pdf" });
  });
});

describe("safeFileName", () => {
  it("keeps a readable name and drops paths, control characters and over-long names", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\a\\Design v2.PNG")).toBe("Design v2.PNG");
    expect(safeFileName("na\u0000me\n.png")).toBe("name.png");
    expect(safeFileName("x".repeat(300) + ".png").length).toBeLessThanOrEqual(120);
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("")).toBe("file");
  });
});

describe("small helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("tells images from documents", () => {
    expect(fileKindOf("image/webp")).toBe("image");
    expect(fileKindOf("application/pdf")).toBe("document");
    expect(ALLOWED_FILE_TYPES).toHaveLength(5);
  });
  it("share links only go into private repositories", () => {
    expect(canLinkFilesInto(true)).toBe(true);
    expect(canLinkFilesInto(false)).toBe(false);
    expect(canLinkFilesInto(null)).toBe(false);
    expect(canLinkFilesInto(undefined)).toBe(false);
  });
});
