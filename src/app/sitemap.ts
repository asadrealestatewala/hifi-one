import type { MetadataRoute } from "next";
import { POSTS } from "./(site)/_content/blog";
import { JOBS } from "./(site)/_content/jobs";
import { SITE_URL } from "./(site)/_content/site";

// Every public website page, for search engines. The ERP is never listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "monthly") => ({ url: `${SITE_URL}${path}`, priority, changeFrequency });
  return [
    page("/", 1, "weekly"),
    ...["/site/services", "/site/pricing", "/site/contact"].map((p) => page(p, 0.9)),
    ...["/site/about", "/site/team", "/site/careers", "/site/blog"].map((p) => page(p, 0.7)),
    page("/site/careers/jobs", 0.8, "weekly"),
    ...JOBS.map((j) => page(`/site/careers/jobs/${j.id}`, 0.6, "weekly")),
    ...POSTS.map((p) => ({ ...page(`/site/blog/${p.slug}`, 0.6), lastModified: p.date })),
  ];
}
