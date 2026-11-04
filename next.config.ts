import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Strict CSP in production. The dev server needs eval and websockets for hot reload, so it gets the other headers only.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next injects inline bootstrap scripts; tighten with per-request nonces when hosting allows
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// The VPS deploy builds into a side folder and swaps it in only when the build succeeds, so a failed build never
// leaves the running server pointing at missing CSS and JS chunks. CI already runs tsc and eslint on every push,
// so the deploy skips them during the build; they are what ran the server out of memory.
const skipBuildChecks = process.env.SKIP_BUILD_CHECKS === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { ignoreBuildErrors: skipBuildChecks },
  eslint: { ignoreDuringBuilds: skipBuildChecks },
  // Uploads travel through server actions; the file size limit itself is enforced by the file service (15 MB)
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  // Resized logo and photos are kept for a day (the default re-checks every minute) and are sent as AVIF or WebP.
  images: { formats: ["image/avif", "image/webp"], minimumCacheTTL: 86400 },
  async headers() {
    return [
      // Files in /public are not fingerprinted, so Next sends them with max-age=0 and phones re-ask for every one on every visit.
      // A day of caching, then a quiet refresh in the background, keeps repeat visits fast; a replaced file shows up within a day.
      { source: "/logo.png", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/site/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      // One-time links and the pages behind them must never be cached by a browser or a proxy
      { source: "/sign/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          ...(isProd
            ? [
                { key: "Content-Security-Policy", value: csp },
                { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
