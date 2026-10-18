import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep recently visited pages for a short while, so switching back to a
    // tab is instant. Any save refreshes them straight away.
    staleTimes: { dynamic: 30, static: 180 },
    serverActions: {
      // Task attachments are uploaded straight to Supabase Storage from the
      // browser, so server actions only carry form data.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
