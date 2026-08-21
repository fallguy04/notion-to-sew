import type { Viewport } from "next";

/**
 * The kiosk's own viewport, so the rest of the site keeps pinch-to-zoom.
 *
 * A customer pinching the catalogue out of alignment on a shared iPad is a
 * support call, and there is nothing on this screen small enough to need it.
 * The back office is the opposite case — small figures, read on a phone.
 */
export const viewport: Viewport = {
  themeColor: "#FBF9F5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
