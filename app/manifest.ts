import type { MetadataRoute } from "next";

// Lets people add Highfy Tasks to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Highfy Tasks",
    short_name: "Highfy Tasks",
    start_url: "/my",
    display: "standalone",
    background_color: "#F5F4F1",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
