// Allow all crawlers; expose the sitemap location so Google / Bing find it
// without manual submission.

import type { MetadataRoute } from "next";

const SITE_URL = "https://iconic.haus";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Don't index server-rendered API endpoints.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
