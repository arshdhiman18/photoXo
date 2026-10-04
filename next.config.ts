import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera is allowed for same-origin (receipt / shoot uploads in later stages)
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev-only Server Function logging prints call arguments — including
  // passwords and invitation tokens. Disabled so secrets never reach terminals.
  logging: { serverFunctions: false },
  serverExternalPackages: ["mongoose", "mongodb", "mongodb-connection-string-url"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Never let invitation / reset tokens leak via Referer.
      { source: "/invite/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/reset-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
