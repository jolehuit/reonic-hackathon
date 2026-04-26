import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://iconic.haus";
const TITLE = "Iconic";
const TAGLINE =
  "From an address to a complete solar design in 30 seconds.";
const DESCRIPTION =
  "Iconic captures any building from Google Photorealistic 3D Tiles, isolates it with GPT Image 2, reconstructs a textured 3D mesh with Hunyuan 3D Pro, then sizes the PV / storage / heat-pump bundle against 1,620 real Iconic deliveries.";

export const metadata: Metadata = {
  // metadataBase makes every relative image URL below resolve against the
  // canonical production origin — required for OpenGraph / Twitter scrapers.
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Iconic" },
  description: DESCRIPTION,
  applicationName: TITLE,
  keywords: [
    "solar design",
    "photovoltaic",
    "PV planning",
    "AI solar",
    "renewable energy",
    "heat pump",
    "Hunyuan 3D",
    "GPT Image 2",
    "3D Tiles",
    "Iconic",
  ],
  authors: [{ name: "Iconic" }],
  creator: "Iconic",
  publisher: "Iconic",

  alternates: { canonical: "/" },

  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: TITLE,
    title: `${TITLE} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: [
      {
        // Resolved by src/app/opengraph-image.tsx (Next.js convention).
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Iconic — From an address to a complete solar design in 30 seconds.",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: `${TITLE} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },

  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },

  // Be explicit so search engines / link unfurlers treat us as indexable.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
