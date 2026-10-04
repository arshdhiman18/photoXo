/**
 * Stand-in for `next/headers` outside a Next.js request. Tests set the cookie
 * header (a real Better Auth session cookie obtained by signing in) to act as
 * a given user — exactly what a browser would send.
 */
let cookieHeader = "";

export function setRequestCookie(cookie: string | null) {
  cookieHeader = cookie ?? "";
}

export async function headers() {
  return new Headers(cookieHeader ? { cookie: cookieHeader, origin: "http://localhost:3000" } : {});
}

export async function cookies() {
  return {
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
  };
}
