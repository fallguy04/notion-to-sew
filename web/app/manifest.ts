import type { MetadataRoute } from "next";

/**
 * Installable from a phone.
 *
 * start_url is the back office rather than "/", because "/" is the device
 * chooser and proxy.ts sends phones from there straight to the kiosk — which
 * is right for a customer standing at the counter and wrong for Mom checking
 * the day's takings from the sofa.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Notion to Sew — Back office",
    short_name: "Notion to Sew",
    description: "Sales, customers, stock and takings for Notion to Sew.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fbf9f5",
    theme_color: "#1f6e5a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
