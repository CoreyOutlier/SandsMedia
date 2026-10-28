import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "Dr. Sands — Posting Center", short_name: "Posting Center", description: "Dr. Sands’ private media portal.", start_url: "/patients", display: "standalone", background_color: "#ffffff", theme_color: "#ffffff", icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }] };
}
