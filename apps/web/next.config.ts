import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared schemas are TypeScript source in the monorepo, so Next compiles them.
  transpilePackages: ["@repo/contracts"],
  // Self-contained server bundle for the Docker image.
  output: "standalone",
};

export default nextConfig;
