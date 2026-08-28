import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { NewsHeader } from "@/modules/news/views/ui/news-header";
import { createClient } from "@/lib/supabase/server";
import { formatStamp } from "@/lib/time";
import type { NewsPost } from "@/lib/types";

export default async function NewsPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  // Anon-role read, allowed by the "anyone can select published" policy
  // (00031_news_posts.sql) — a draft's slug 404s here for anyone but the admin.
  const { data: post } = await supabase
    .from("news_posts")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle<NewsPost>();
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-white">
      <NewsHeader />

      <main className="mx-auto max-w-3xl px-6 pt-6 pb-24">
        <Link
          href="/news"
          className="animate-rise inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeftIcon size={13} />
          All news
        </Link>

        <article className="animate-rise rise-1 mt-6">
          <p className="text-[12.5px] font-medium text-muted-foreground">
            {formatStamp(post.created_at)}
          </p>
          <h1 className="mt-1.5 font-serif text-[36px] tracking-tight text-foreground sm:text-[46px]">
            {post.title}
          </h1>
          <p className="mt-6 whitespace-pre-wrap text-[15.5px] leading-relaxed text-secondary-foreground">
            {post.body}
          </p>
        </article>
      </main>
    </div>
  );
}
