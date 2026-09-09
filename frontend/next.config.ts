import type { NextConfig } from "next";

const allowedDevOrigins = process.env.SVARASENTRY_ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
