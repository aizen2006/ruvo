import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared schemas are TypeScript source in the monorepo, so Next compiles them.
  transpilePackages: ["@repo/contracts"],
};

export default nextConfig;
