import type { Metadata } from "next";
import { Bodoni_Moda, Cormorant_Garamond, Manrope } from "next/font/google";
import { siteOrigin } from "@/lib/site";
import "./globals.css";

// Bodoni for names, headlines and the 42 mark; Cormorant for editorial copy;
// Manrope for small-caps labels and UI.
const display = Bodoni_Moda({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const serif = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Absolute base for canonical and OpenGraph URLs (Search Console requires absolute canonicals).
const siteUrl = siteOrigin() ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "42 Model Management",
    template: "%s — 42 Model Management",
  },
  ...(process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? { robots: { index: false, follow: false } } : {}),
  description: "42 Model Management represents distinctive talent for modern brands, editorial, and culture.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Demo builds mark every page as "Demo Mode"; production builds never load this.
  const DemoBar = process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? (await import("@/features/demo/DemoBar")).DemoBar : null;
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${serif.variable} ${sans.variable}`}>
      <body>{children}{DemoBar && <DemoBar />}</body>
    </html>
  );
}

