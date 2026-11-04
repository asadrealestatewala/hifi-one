import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// The monospace face is only used for codes and numbers, so it loads when needed instead of delaying the first paint.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: { default: "Hifi One", template: "%s · Hifi One" },
  description: "Unified ERP for Hifi Marketing and Technologies",
  // ?v= busts browser and phone icon caches when the mark changes
  icons: {
    icon: [{ url: "/icons/favicon-32.png?v=2", sizes: "32x32", type: "image/png" }, { url: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180" }],
    shortcut: "/favicon.ico?v=2",
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies the saved theme before the first paint so there is no flash of the wrong colours.
const THEME = `try{var t=localStorage.getItem("hifi.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;else if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
