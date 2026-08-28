import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/project/", "/profile", "/billing", "/onboarding", "/verify-email"],
    },
    sitemap: "https://meero.im/sitemap.xml",
  };
}
