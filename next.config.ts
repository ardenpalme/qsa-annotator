import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/annotate", destination: "http://localhost:8080", permanent: false },
    ]
  },
};

export default nextConfig;
