import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async headers() {
    const immutableCache = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/assets/hidden-village-sunset.webp", headers: immutableCache },
      { source: "/uploads/:path*", headers: immutableCache }
    ];
  },
  experimental: {
    webpackMemoryOptimizations: true,
    preloadEntriesOnStart: false,
    serverActions: {
      bodySizeLimit: "3mb"
    }
  }
};

export default nextConfig;
