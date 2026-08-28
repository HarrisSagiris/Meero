import type { Metadata } from "next";
import { Geist_Mono, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/modules/sidebar/views/ui/app-sidebar";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const viewport = {
  themeColor: "#ffffff",
};

const SITE_URL = "https://meero.im";
const DESCRIPTION =
  "Meero turns natural-language ideas into real, secure, full-stack web apps — real Postgres, real user accounts, running on your own Supabase. Pro and Ultra unlock one-click Vercel releases, and every build can ship as a real GitHub pull request.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Meero — Describe it. Ship it.",
    template: "%s — Meero",
  },
  description: DESCRIPTION,
  applicationName: "Meero",
  keywords: [
    "Meero",
    "AI app builder",
    "Supabase app generator",
    "natural language to app",
    "Next.js app builder",
    "AI full-stack generator",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/meeromodern.png",
    shortcut: "/meeromodern.png",
    apple: "/meeromodern.png",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Meero",
    title: "Meero — Describe it. Ship it.",
    description: DESCRIPTION,
    images: [{ url: "/meeromodern.png", width: 1024, height: 1024, alt: "Meero" }],
  },
  twitter: {
    card: "summary",
    title: "Meero — Describe it. Ship it.",
    description: DESCRIPTION,
    images: ["/meeromodern.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Meero",
  alternateName: "Meero AI",
  url: SITE_URL,
  logo: `${SITE_URL}/meeromodern.png`,
  description: DESCRIPTION,
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Meero",
  url: SITE_URL,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html
      lang="en"
      // Some browser extensions (password managers, "crx launcher" style
      // tools) inject attributes onto <html> before React hydrates —
      // that's a real DOM mutation outside React's control, not a bug in
      // this app, and the documented fix is exactly this prop: React keeps
      // whatever's in the DOM for this element instead of erroring.
      suppressHydrationWarning
      className={`${plusJakartaSans.className} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(ORGANIZATION_JSON_LD).replace(/</g, "\\u003c"),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(WEBSITE_JSON_LD).replace(/</g, "\\u003c"),
          }}
        />
        <AppShell sidebar={user ? <AppSidebar /> : null}>{children}</AppShell>
      </body>
    </html>
  );
}
