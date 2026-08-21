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
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#FBF9F5",
  width: "device-width",
  initialScale: 1,
  // Zoom stays available here. It is switched off for the kiosk only, in that
  // segment's own viewport: a customer pinching the catalogue out of alignment
  // is a support call, but the back office on a phone is small type someone
  // reads in poor light, and taking pinch-to-zoom away from it is unkind.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        {/* Fall Studios analytics. Client-side only — it never touches the
            database. Cookieless, skips localhost, and stores the pathname with
            query strings stripped, so no order or customer detail leaves here.
            data-site must match the slug in fall-studios/lib/projects.ts. */}
        <script defer src="https://fall-studios.vercel.app/t.js" data-site="notion-to-sew" />
      </head>
      <body>{children}</body>
    </html>
  );
}
