import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Nymspace — ENS as the identity layer";
const description =
  "I would make ENS the identity layer, then choose partners that naturally become the data and execution layers.";

/**
 * `WEB_ORIGIN` is the comma-separated allowlist `docs/19_ENV_AND_CONFIG.md`
 * defines for CORS; its first entry is this deployment's own origin, which is
 * what `metadataBase` needs. Reusing it keeps one variable authoritative for
 * "where the web app lives" rather than adding a second that can drift.
 *
 * `metadataBase` is what turns the relative `opengraph-image` URL into the
 * absolute one crawlers require. Without it Next warns and falls back to
 * localhost, which ships a card no scraper can fetch.
 */
const siteUrl = (process.env.WEB_ORIGIN ?? "http://localhost:3111")
  .split(",")[0]
  .trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Nymspace",
    url: "/",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes writes the class before paint; React would otherwise warn
      // about the server/client markup differing.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
