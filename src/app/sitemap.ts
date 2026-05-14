import type { MetadataRoute } from "next";
import { partPagePath } from "@/lib/agent-parts";
import { getParts } from "@/lib/parts";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/llms.txt"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  const partRoutes: MetadataRoute.Sitemap = getParts().map((part) => ({
    url: absoluteUrl(partPagePath(part)),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...partRoutes];
}
