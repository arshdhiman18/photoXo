import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate ONLY: redirects requests without a session cookie to
 * /login to avoid rendering protected shells for anonymous visitors.
 *
 * This is NOT a security boundary. Every layout, page, Server Action and
 * Route Handler independently resolves the Actor from the database-backed
 * session and authorises the request.
 */
const SESSION_COOKIES = ["photoxo.session_token", "__Secure-photoxo.session_token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/work/:path*", "/client/:path*"],
};
