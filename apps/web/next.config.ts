import type { NextConfig } from "next";
import path from "path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const monorepoRoot = path.join(__dirname, "../../");

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Trace the whole monorepo (not just this app) so the standalone output
  // includes the hoisted root node_modules — see Dockerfile. Must match
  // turbopack.root below, or Next warns and picks outputFileTracingRoot anyway.
  outputFileTracingRoot: monorepoRoot,
  // Pin the workspace root (a stray lockfile in the home dir confuses inference).
  turbopack: {
    root: monorepoRoot,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
