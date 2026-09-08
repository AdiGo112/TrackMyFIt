import type { NextConfig } from "next";

/**
 * Response headers. Every one of these is a default-deny for a capability this
 * app never uses, so nothing here has a knob to tune later.
 *
 * ponytail: no Content-Security-Policy. A real one needs per-request nonces for
 * the inline scripts Next injects, which means middleware on every route — worth
 * doing the day this app renders anything user-submitted, and not before.
 */
const SECURITY_HEADERS = [
  // The app is never framed; this is the clickjacking defence.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Auth tokens ride in the URL fragment on the reset link. Fragments are never
  // sent in a Referer, but trimming cross-origin referrers costs nothing.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
