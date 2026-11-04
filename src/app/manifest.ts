import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hifi One",
    short_name: "Hifi One",
    description: "Unified ERP for Hifi Marketing and Technologies",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d10f0f",
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
