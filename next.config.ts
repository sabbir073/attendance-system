import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Native / node-only packages must not be bundled by Turbopack.
  serverExternalPackages: [
    "@node-rs/argon2",
    "@prisma/adapter-pg",
    "@prisma/client",
    "pg",
    "qrcode",
  ],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            // geolocation and camera are both required by the attendance
            // flow (GPS punch and face recognition); everything else off.
            value:
              "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js injects inline bootstrap scripts.
              // 'wasm-unsafe-eval' is required by the TensorFlow.js WASM
              // backend that powers on-device face recognition.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
              "media-src 'self' blob:",
              "font-src 'self' data:",
              // jsDelivr is only contacted if build-time model vendoring
              // failed; with models in public/models nothing leaves the host.
              "connect-src 'self' https://cdn.jsdelivr.net",
              "frame-src 'self' https://www.openstreetmap.org",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
