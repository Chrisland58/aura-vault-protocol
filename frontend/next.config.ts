import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export — produces /out directory served by nginx:alpine in Docker.
  // All pages are "use client" with no server-side data fetching, so a full
  // static export is safe and gives a sub-50MB final image.
  output: "export",
  compress: true,
  experimental: {
    useTypeScriptCli: true,
  },
  turbopack: {
    root: __dirname,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    deviceSizes: [320, 640, 768, 1024, 1280, 1920, 2560],
  },
  async headers() {
    return [
      {
        // Immutable cache for hashed static assets
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Short cache for HTML pages
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
