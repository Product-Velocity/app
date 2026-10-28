/** Names shared by the proxy and the session helpers; kept apart so the proxy does not pull in server-only modules. */
export const TENANT_COOKIE = "pv_tenant";
/** Set by the proxy when the address is /w/{account}/...: the account the person asked for, before any access check. */
export const URL_TENANT_HEADER = "x-pv-tenant";
