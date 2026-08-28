"use client";

import { useRef, useState, useActionState, useTransition } from "react";
import {
  createNewsPost,
  deleteNewsPost,
  togglePublished,
  type AdminState,
} from "@/modules/admin/actions/admin-actions";
import { createClient } from "@/lib/supabase/client";
import { formatStamp } from "@/lib/time";
import type { NewsPost } from "@/lib/types";

const initialState: AdminState = {};

/** Create + manage news posts (00031_news_posts.sql) — shown as the top
 *  announcement bar (news-bar.tsx) and listed at /news once published. */
export function NewsManager({ posts }: { posts: NewsPost[] }) {
  const [state, formAction, pending] = useActionState(createNewsPost, initialState);
  // Uncontrolled inputs don't clear themselves after a server action — remount
  // the form once a post actually saves so the fields go blank for the next
  // one. Adjusting state during render (guarded by the prevState comparison)
  // rather than in an effect, per React's "you might not need an effect".
  const [key, setKey] = useState(0);
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.saved) setKey((k) => k + 1);
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-white p-6 shadow-primary/10">
      <h2 className="mb-1 text-[15px] font-semibold text-foreground">News</h2>
      <p className="mb-5 text-[13px] text-muted-foreground">
        Posted here shows as the orange announcement bar above the navbar and on the public /news
        page.
      </p>

      <form key={key} action={formAction} className="mb-6 flex flex-col gap-2.5">
        <input
          name="title"
          placeholder="Post title"
          required
          className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground"
        />
        <textarea
          name="body"
          placeholder="What's new…"
          required
          rows={4}
          className="w-full resize-none rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground"
        />
        <ImageField />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[12.5px] text-secondary-foreground">
            <input
              type="checkbox"
              name="published"
              defaultChecked
              className="size-3.5 rounded border-input"
            />
            Publish immediately
          </label>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Posting…" : "Post"}
          </button>
        </div>
        {state.error && <p className="text-[12px] text-red-600">{state.error}</p>}
        {state.saved && <p className="text-[12px] text-emerald-700">Posted.</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {posts.length === 0 && <li className="text-[13px] text-muted-foreground">No posts yet.</li>}
        {posts.map((post) => (
          <PostRow key={post.id} post={post} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Optional photo for a post — uploads straight to the public `news-images`
 * Storage bucket (00032_news_images.sql, admin-only write) the moment a
 * file is picked, then carries the resulting public URL into the form via
 * a hidden field. Entirely self-contained so remounting the parent form
 * (the `key` reset after a successful post) resets this too.
 */
function ImageField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("news-images").upload(path, file);
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      const { data } = supabase.storage.from("news-images").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input type="hidden" name="image_url" value={imageUrl ?? ""} />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {imageUrl ? (
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- Storage public URL, not a local/optimizable asset */}
          <img src={imageUrl} alt="" className="size-14 rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => {
              setImageUrl(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            Remove photo
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-dashed border-input px-3.5 py-2.5 text-[13px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Add a photo (optional)"}
        </button>
      )}
      {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}

function PostRow({ post }: { post: NewsPost }) {
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        {post.image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- Storage public URL, not a local/optimizable asset
          <img src={post.image_url} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{post.title}</span>
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                post.published
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {post.published ? "Published" : "Draft"}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {formatStamp(post.created_at)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              void togglePublished(post.id, !post.published);
            })
          }
          className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-50"
        >
          {post.published ? "Unpublish" : "Publish"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Delete "${post.title}"? This can't be undone.`)) return;
            startTransition(() => {
              void deleteNewsPost(post.id);
            });
          }}
          className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
