import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@openstudy/shared"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // The dev badge would sit on top of the lesson controls in the corner.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
