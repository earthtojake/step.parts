import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteConfig } from "@/lib/site";
import "./globals.css";

const themeScript = `
(() => {
  const root = document.documentElement;
  const systemTheme =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  let theme = systemTheme;

  try {
    const storedTheme = window.localStorage.getItem("step-parts-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      theme = storedTheme;
    }
  } catch {
    // Fall back to the system theme when storage is unavailable.
  }

  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
})();
`;

const socialPreviewImage = {
  url: "/step-parts-social-preview.png",
  width: 1200,
  height: 630,
  alt: "step.parts open source CAD directory showing a searchable grid of colorful CAD parts.",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.origin),
  applicationName: siteConfig.name,
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: "/",
    siteName: siteConfig.name,
    type: "website",
    images: [socialPreviewImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
    images: [socialPreviewImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "engineering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <TooltipProvider>{children}</TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
