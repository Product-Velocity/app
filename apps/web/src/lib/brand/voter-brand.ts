import { derivePalette, voterVars, type BrandPalette } from "@pv/domain";

/**
 * Whether a voting session shows the company brand, and how (issue #750). Pure: the row of the workspace brand, the workspace name and the session's own choice in,
 * a ready-to-use brand out. A brand is used only when it is CONFIRMED, switched on for voting, the session did not opt out and it has a main colour; otherwise the
 * Product Velocity look is used. The colours are always the derived, readable set (never the raw ones).
 */
export type BrandRow = {
  status: string;
  use_on_voting: boolean;
  display_name: string | null;
  primary_color: string | null;
  accent_color: string | null;
  logo_path: string | null;
  public_token: string;
};

export type VoterBrandView = {
  /** The name shown beside the logo, always as live text. */
  name: string;
  /** The logo's address on this site, or null. */
  logoPath: string | null;
  palette: BrandPalette;
  /** CSS variables for the voting screens. */
  vars: Record<string, string>;
};

export function voterBrandFor(row: BrandRow | null, tenantName: string, sessionUseBrand: boolean): VoterBrandView | null {
  if (!row || !sessionUseBrand || row.status !== "confirmed" || !row.use_on_voting || !row.primary_color) return null;
  const p = derivePalette(row.primary_color, row.accent_color ?? undefined);
  if (!p.ok) return null;
  const name = (row.display_name ?? "").trim() || tenantName.trim() || "Your company";
  return { name, logoPath: row.logo_path ? `/b/${row.public_token}/logo.png` : null, palette: p.palette, vars: voterVars(p.palette) };
}

/** What the email layout needs: absolute logo address, name, button colours and link colour. */
export type EmailBrand = { name: string; logoUrl: string | null; color: string; onColor: string; linkColor: string };

export function emailBrandFrom(v: VoterBrandView | null, siteUrl: string): EmailBrand | null {
  if (!v) return null;
  return { name: v.name, logoUrl: v.logoPath ? `${siteUrl.replace(/\/$/, "")}${v.logoPath}` : null, color: v.palette.brand, onColor: v.palette.onBrand, linkColor: v.palette.brandStrong };
}
