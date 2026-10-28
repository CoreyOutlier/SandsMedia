import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Posting Center | Dr. Sands", template: "%s | Dr. Sands" },
  description: "Dr. Sands’ private media portal.",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/icon-192.png", apple: "/brand/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Posting Center", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff", colorScheme: "light" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
