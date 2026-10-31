import type { MetadataRoute } from "next";
import { SITE_URL } from "./(site)/_content/site";

// Search engines may index the public website ("/" and /site) and the assets it needs; the ERP behind sign-in is off limits.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/site", "/_next/"], disallow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
