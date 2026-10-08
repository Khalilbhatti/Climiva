import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile-time check that every <Link href> points at a real route.
  typedRoutes: true,
};

export default nextConfig;
