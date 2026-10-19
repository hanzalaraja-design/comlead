import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // scripts/screenshots.ts builds its demo copy into a separate folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Keep recently visited pages for a short while, so switching back to a
    // tab is instant. Any save refreshes them straight away.
    staleTimes: { dynamic: 30, static: 180 },
    serverActions: {
      // Task attachments go straight to Supabase Storage from the browser.
      // The largest server action body is photos of meeting notes, shrunk in
      // the browser to well under 1 MB each, up to four at a time.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
