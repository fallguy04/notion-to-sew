import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

/**
 * Self-hosted at build time rather than fetched from Google's CDN. One fewer
 * origin to reach on shop wifi that comes and goes, and no third party learning
 * who visits the shop's kiosk.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Notion to Sew",
  description: "Quality supplies · Local service",
  // Added to the iPad home screen, this runs without Safari's chrome — which is
  // what makes it feel like an appliance rather than a web page someone can
  // navigate away from.
  appleWebApp: { capable: true, title: "Notion to Sew", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#FBF9F5",
  width: "device-width",
  initialScale: 1,
  // A customer pinching the catalogue out of alignment is a support call.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
