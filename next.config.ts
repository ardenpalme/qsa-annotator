import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async redirects() {
    return [
      { source: "/annotate", destination: "https://cvat.fpcadanot438.xyz", permanent: false },
    ]
  },
};

export default nextConfig;
