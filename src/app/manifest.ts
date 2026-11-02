import type { MetadataRoute } from "next";

// Makes Hifi One installable ("Add to Home screen") on phones and desktops. It opens straight into the app; sign-in
// is still enforced server-side on every page, so an installed copy sees exactly what the browser would.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hifi One",
    short_name: "Hifi One",
    description: "Unified ERP for Hifi Marketing and Technologies",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7fb",
    theme_color: "#0f1230",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
