import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";

/** Routes that are reachable without a session. Everything else is protected. */
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  // API routes enforce their own auth (ingest secrets, cron bearer token, or
  // Supabase session) and must answer JSON 401s — never a login redirect.
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refresh the Supabase auth session on every matched request and redirect
 * unauthenticated users away from protected routes.
 *
 * Pattern follows the @supabase/ssr docs: the request cookies and the
 * response cookies must be kept in sync, and no logic may run between
 * creating the client and calling `auth.getClaims()`.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getClaims() —
  // a subtle bug here can cause users to be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: return supabaseResponse as-is so refreshed auth cookies reach
  // the browser. If you need a different response, copy the cookies over.
  return supabaseResponse;
}
