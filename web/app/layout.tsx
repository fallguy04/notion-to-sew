import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
