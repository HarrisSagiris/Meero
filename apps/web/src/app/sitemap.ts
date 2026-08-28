import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  // Anon-role read, same "anyone can select published" policy /news itself
  // uses (00031_news_posts.sql) — a draft never leaks into the sitemap.
  const { data: posts } = await supabase
    .from("news_posts")
    .select("slug, updated_at")
    .eq("published", true)
    .order("created_at", { ascending: false });

  return [
    {
      url: "https://meero.im",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://meero.im/login",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: "https://meero.im/signup",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://meero.im/news",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...(posts ?? []).map((post) => ({
      url: `https://meero.im/news/${post.slug}`,
      lastModified: new Date(post.updated_at as string),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
