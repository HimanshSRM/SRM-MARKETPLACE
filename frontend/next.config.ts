import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development", 
});

const nextConfig: NextConfig = {
  turbopack: {}, // 🚨 FIX: Silences the Webpack/Turbopack conflict
};

export default withPWA(nextConfig);