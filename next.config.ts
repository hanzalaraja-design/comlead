import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Task attachments are uploaded straight to Supabase Storage from the
      // browser, so server actions only carry form data.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
