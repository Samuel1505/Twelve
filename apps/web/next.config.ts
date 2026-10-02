import type { NextConfig } from "next";

const config: NextConfig = {
  // @twelve/shared ships TypeScript source (branded units, report schema, chain constants)
  transpilePackages: ["@twelve/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
