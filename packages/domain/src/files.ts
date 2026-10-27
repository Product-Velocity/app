// Files attached to an initiative (R-034 step 4). What may be stored, how it is checked and what a share link may do.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_ITEM = 20;
export const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"] as const;
export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The type the bytes really are, from their first bytes. The file name and the browser's claim are never trusted (SVG and HTML can run scripts). */
export function sniffFileType(b: Uint8Array): AllowedFileType | null {
  if (b.length < 4) return null;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export const fileKindOf = (mime: string): "image" | "document" => (mime.startsWith("image/") ? "image" : "document");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A readable name without paths or control characters, at most 120 characters (keeping the extension). */
export function safeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = raw.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()!.trim();
  if (!base || /^\.+$/.test(base)) return "file";
  if (base.length <= 120) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 120 - ext.length) + ext;
}

export type UploadCheck = { ok: true; mime: AllowedFileType; name: string } | { ok: false; error: string };

export function validateUpload(i: { name: string; bytes: Uint8Array; size: number; declaredType?: string; existingCount: number }): UploadCheck {
  if (i.size > MAX_FILE_BYTES) return { ok: false, error: "That file is larger than 10 MB." };
  if (i.existingCount >= MAX_FILES_PER_ITEM) return { ok: false, error: `An initiative can have at most ${MAX_FILES_PER_ITEM} files. Remove one first.` };
  if (i.size === 0 || i.bytes.length === 0) return { ok: false, error: "That file is empty." };
  const mime = sniffFileType(i.bytes);
  if (!mime) return { ok: false, error: "Only PNG, JPEG, GIF, WebP and PDF files can be attached." };
  return { ok: true, mime, name: safeFileName(i.name) };
}

/** Share links are only written into issues of private repositories; an unknown or public repository gets none. */
export const canLinkFilesInto = (isPrivate: boolean | null | undefined): boolean => isPrivate === true;

// ---------------------------------------------------------------- files sent by Claude (docs/20 FR-5)

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
/** What base64 text of a given length decodes to, at most (used to meter and refuse before decoding anything). */
export const base64ByteLength = (s: string): number => Math.floor((s.length * 3) / 4);

export type Decoded = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Base64 (or a `data:...;base64,` URL) to bytes. Size is checked on the text first, so a huge string is never decoded. */
export function decodeBase64File(input: unknown): Decoded {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, error: "Send the file as base64 text in content_base64." };
  const text = input.trim().replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  if (base64ByteLength(text) > MAX_FILE_BYTES + 2) return { ok: false, error: "That file is larger than 10 MB." };
  if (!B64.test(text)) return { ok: false, error: "content_base64 is not valid base64 text." };
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: true, bytes };
  } catch {
    return { ok: false, error: "content_base64 is not valid base64 text." };
  }
}

/** The repository an initiative would be pushed to: its name (when known) and whether GitHub says it is private (null = not known). */
export type FileRepo = { name: string | null; isPrivate: boolean | null };

/**
 * The plain-words result of switching a share link on or off (docs/04 Files, docs/20 FR-5). Claude relays it to the person,
 * so it says who can open the file and whether the link will reach a GitHub issue.
 */
export function sharingNote(on: boolean, repo: FileRepo): string {
  if (!on) return "Sharing is off. The old link stopped working at once (it now answers 404). Turning sharing on again makes a new link.";
  const open = "Anyone who has this link can open the file, without signing in.";
  if (repo.isPrivate === true) return `${open} ${repo.name ? `The repository ${repo.name} is` : "The repository is"} private, so the link will be added to the GitHub issue on the next push (Update GitHub, which the person confirms).`;
  if (repo.name && repo.isPrivate === false) return `${open} WARNING: ${repo.name} is a PUBLIC repository, so the link will NOT be written to the GitHub issue: anyone could read it there. The link still works wherever the person pastes it.`;
  return `${open} No repository known to be private is linked to this initiative, so the link will not be written to a GitHub issue. The link still works wherever the person pastes it.`;
}
