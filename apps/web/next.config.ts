import type { NextConfig } from "next";

const isBuild = process.env.NODE_ENV === "production";
const API_DEV = process.env.API_DEV_URL ?? "http://127.0.0.1:4000";

/**
 * Production: static export served next to the API behind one reverse proxy (/api -> apps/api).
 * Development: `next dev` proxies /api to the local API so cookies stay same-origin.
 * (Static export forbids rewrites, so they exist only in dev.)
 */
const nextConfig: NextConfig = {
  ...(isBuild ? { output: "export" as const } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    globalNotFound: true,
  },
  ...(isBuild ? {} : { rewrites: async () => [{ source: "/api/:path*", destination: `${API_DEV}/api/:path*` }] }),
};

export default nextConfig;
