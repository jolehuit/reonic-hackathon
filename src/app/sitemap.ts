// Sitemap covering the demo entry points. The /design/[houseId] pages are
// reachable from the landing modal but they're interactive (3D agent run +
// fal calls), not really useful in search results — keep them out so we
// don't waste crawl budget.

import type { MetadataRoute } from "next";

const SITE_URL = "https://iconic.haus";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
