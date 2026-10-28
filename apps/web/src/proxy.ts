import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseAccountPath, screenOf } from "@/lib/account-path";
import { TENANT_COOKIE, URL_TENANT_HEADER } from "@/lib/session-keys";

/**
 * Keeps the Supabase session cookie fresh, and understands /w/{account}/{page}: the prefix is removed (the page keeps its normal route) and
 * the account is passed on in a header. Access checks live in lib/session.ts; nothing here decides who may open an account.
 */
export async function proxy(request: NextRequest) {
  const account = parseAccountPath(request.nextUrl.pathname);
  // a client must never choose the account by sending this header itself
  const headers = new Headers(request.headers);
  headers.delete(URL_TENANT_HEADER);
  if (account) headers.set(URL_TENANT_HEADER, account.tenantId);
  // which screen the request is for: the audit log records it next to every change (R-111 FR-6.2)
  headers.delete("x-pv-screen");
  const screen = screenOf(request.nextUrl.pathname);
  if (screen) headers.set("x-pv-screen", screen);
  const target = account ? new URL(account.rest + request.nextUrl.search, request.url) : null;
  const forward = () => (target ? NextResponse.rewrite(target, { request: { headers } }) : NextResponse.next({ request: { headers } }));
  const remember = (res: NextResponse) => {
    // only a preference for the next visit; whether the person may open the account is checked on every request
    if (account) res.cookies.set(TENANT_COOKIE, account.tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return res;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return remember(forward());

  let response = forward();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return remember(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
