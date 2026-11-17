import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL bringt native Bindings mit und darf nicht gebündelt werden.
  serverExternalPackages: ["@libsql/client", "libsql"],
  async headers() {
    return [
      {
        // Grundschutz für alle Seiten. Skripte nur vom eigenen Server (Next.js braucht Inline-Skripte für das Seiten-Hydrieren).
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
          ...(process.env.NODE_ENV === "production"
            ? [
                { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
                {
                  key: "Content-Security-Policy",
                  value: [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline'",
                    "img-src 'self' data: blob: https:",
                    "font-src 'self' data:",
                    "connect-src 'self'",
                    "media-src 'self' blob:",
                    "frame-src https:",
                    "frame-ancestors 'self'",
                    "base-uri 'self'",
                    "object-src 'none'",
                    "form-action 'self'",
                  ].join("; "),
                },
              ]
            : []),
        ],
      },
      {
        // Service Worker immer frisch laden, damit Updates sofort greifen.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
