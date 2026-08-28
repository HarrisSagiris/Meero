import { NewsBarContent } from "@/modules/news/views/ui/news-bar-content";
import { createClient } from "@/lib/supabase/server";
import type { NewsPost } from "@/lib/types";

/**
 * Top announcement bar — sits above the navbar on every page that renders
 * it, surfacing the latest published post (00031_news_posts.sql, posted
 * from /admin) and linking to the public /news page. Self-contained: fetches
 * its own data so it can drop into both the logged-in dashboard (page.tsx)
 * and the logged-out landing page (landing.tsx) without prop-threading.
 * Renders nothing when there's no published post.
 * The animated pixel background (news-bar-content.tsx) needs a client
 * component, so this server component only fetches and hands off the title.
 */
export async function NewsBar() {
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("news_posts")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<NewsPost>();
  if (!post) return null;

  return <NewsBarContent title={post.title} />;
}
