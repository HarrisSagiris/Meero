import Link from "next/link";
import { NewsHeader } from "@/modules/news/views/ui/news-header";
import { createClient } from "@/lib/supabase/server";
import { formatStamp } from "@/lib/time";
import type { NewsPost } from "@/lib/types";

export const metadata = {
  title: "News — Meero",
  description: "What's new at Meero.",
};

export default async function NewsPage() {
  const supabase = await createClient();
  // Anon-role read, allowed by the "anyone can select published" policy
  // (00031_news_posts.sql) — works for logged-out visitors too.
  const { data } = await supabase
    .from("news_posts")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false });
  const posts = (data ?? []) as NewsPost[];

  return (
    <div className="min-h-screen bg-white">
      <NewsHeader />

      <main className="mx-auto max-w-xl px-6 pt-10 pb-24">
        <div className="animate-rise">
          <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            Changelog
          </p>
          <h1 className="mt-2 font-serif text-[40px] tracking-tight text-foreground sm:text-[48px]">
            What&apos;s new at <span className="meero-text-gradient">Meero</span>
          </h1>
        </div>

        {posts.length === 0 ? (
          <p className="animate-rise rise-1 mt-14 text-[14px] text-muted-foreground">
            Nothing posted yet — check back soon.
          </p>
        ) : (
          <div className="mt-12 flex flex-col divide-y divide-border">
            {posts.map((post, i) => (
              <Link
                key={post.id}
                href={`/news/${post.slug}`}
                style={{ animationDelay: `${Math.min(i + 1, 6) * 60}ms` }}
                className="animate-rise group flex items-start gap-4 py-6 first:pt-0"
              >
                {post.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage public URL, not a local/optimizable asset
                  <img
                    src={post.image_url}
                    alt=""
                    className="size-20 shrink-0 rounded-xl object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-muted-foreground">
                    {formatStamp(post.created_at)}
                  </p>
                  <h2 className="mt-1.5 font-serif text-[24px] tracking-tight text-foreground transition group-hover:text-primary">
                    {post.title}
                  </h2>
                  <p className="mt-1.5 line-clamp-2 text-[14.5px] leading-relaxed text-secondary-foreground">
                    {post.body}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
