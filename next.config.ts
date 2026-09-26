import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async redirects() {
    return [
      { source: "/annotate", destination: "http://localhost:8080", permanent: false },
    ]
  },
};

export default nextConfig;
