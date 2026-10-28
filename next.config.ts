import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  logging: { incomingRequests: false, fetches: { fullUrl: false } },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
      { key: "Cache-Control", value: "private, no-store, max-age=0" }
    ] }];
  }
};
export default config;
