import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile-time check that every <Link href> points at a real route.
  typedRoutes: true,
  // The Docker image runs the self-contained server this setting makes `next build` emit (see Dockerfile). It is opt-in
  // so that `npm run start` and the browser tests keep using the ordinary production server.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
