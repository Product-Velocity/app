import { parseCompanyUrl, parseEmailDomains } from "@pv/domain";

/** Country, currency, time zone and authorized domains of a workspace (FR-1.2), read from a form. Lists come from the runtime's Intl data. */
export type WorkspaceProfile = { country: string | null; currency: string | null; timeZone: string | null; domains: string[]; companyUrl: string | null };

const supported = (key: "currency" | "timeZone"): string[] => {
  try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(key); } catch { return []; }
};

export const currencyOptions = (): string[] => supported("currency");
export const timeZoneOptions = (): string[] => ["UTC", ...supported("timeZone").filter((z) => z !== "UTC")];

/** Country names in English, from ISO region codes (AA to ZZ that Intl knows). */
export function countryOptions(): string[] {
  let names: Intl.DisplayNames;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { return []; }
  const out = new Set<string>();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    let n: string | undefined;
    try { n = names.of(code); } catch { n = undefined; }
    if (n && n !== code && !/^Unknown/.test(n)) out.add(n);
  }
  return [...out].sort((x, y) => x.localeCompare(y));
}

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

export function parseWorkspaceProfile(form: FormData, opts: { requireDomain: boolean }): WorkspaceProfile | { error: string } {
  const country = text(form.get("country")) || null;
  if (country && country.length > 80) return { error: "Choose a country from the list." };
  const currency = text(form.get("currency")).toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "Choose a currency from the list." };
  const timeZone = text(form.get("time_zone")) || null;
  if (timeZone && timeZone.length > 64) return { error: "Choose a time zone from the list." };
  const parsed = parseEmailDomains(text(form.get("domains")));
  if (!parsed.ok) return { error: parsed.error };
  if (opts.requireDomain && parsed.domains.length === 0) return { error: "Add at least one authorized email domain, for example your company's." };
  const url = parseCompanyUrl(text(form.get("company_url")));
  if (!url.ok) return { error: url.error };
  return { country, currency, timeZone, domains: parsed.domains, companyUrl: url.url };
}
