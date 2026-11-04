import type { MetadataRoute } from "next";

// Lets a phone add Hifi One to the home screen with the red H icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hifi One",
    short_name: "Hifi One",
    description: "Unified ERP for Hifi Marketing and Technologies",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
