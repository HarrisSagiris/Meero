"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_EMAIL } from "@/lib/admin";
import { RESERVED_TOP_LEVEL_SLUGS } from "@/lib/reserved-slugs";
import { createClient } from "@/lib/supabase/server";

export type AdminState = { error?: string; saved?: boolean };

/**
 * RLS already restricts the update to ADMIN_EMAIL (00019_admin_signup_cap.sql)
 * — this check just turns a silent zero-row update into a real error message
 * for anyone who somehow reaches this action without being the admin.
 */
export async function updateSignupCap(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return { error: "Not authorized." };
  }

  const raw = String(formData.get("signupCap") ?? "").trim();
  let signupCap: number | null;
  if (raw === "") {
    signupCap = null;
  } else {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: "Enter a whole number of 0 or more, or leave blank for unlimited." };
    }
    signupCap = parsed;
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ signup_cap: signupCap })
    .eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { saved: true };
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      // A title that's all punctuation/emoji would otherwise slugify to "".
      .slice(0, 80) || `post-${Date.now()}`
  );
}

/**
 * Creates a news post — shown as the top announcement bar
 * (news-bar.tsx) and listed at /news once published. RLS already
 * restricts writes to ADMIN_EMAIL (00031_news_posts.sql); this check just
 * turns a silent zero-row insert into a real error message.
 */
export async function createNewsPost(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return { error: "Not authorized." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const published = formData.get("published") === "on";
  // Uploaded client-side (news-manager.tsx) to the public news-images
  // bucket before this action runs — this field just carries the
  // resulting public URL, never a raw file (server actions body-size
  // limits aside, uploads go straight to Storage, not through this action).
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  if (!title || !body) {
    return { error: "Title and body are both required." };
  }

  const { error } = await supabase.from("news_posts").insert({
    title,
    body,
    published,
    slug: slugify(title),
    image_url: imageUrl || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/news");
  revalidatePath("/");
  return { saved: true };
}

export async function togglePublished(postId: string, published: boolean): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return;

  await supabase.from("news_posts").update({ published }).eq("id", postId);

  revalidatePath("/admin");
  revalidatePath("/news");
  revalidatePath("/");
}

export async function deleteNewsPost(postId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return;

  await supabase.from("news_posts").delete().eq("id", postId);

  revalidatePath("/admin");
  revalidatePath("/news");
  revalidatePath("/");
}

/**
 * Creates a creator referral link (meero.im/{slug}) — RLS already
 * restricts writes to ADMIN_EMAIL (00047_creator_referrals.sql); this check
 * just turns a silent zero-row insert into a real error message.
 */
export async function createCreatorReferral(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return { error: "Not authorized." };
  }

  const creatorName = String(formData.get("creator_name") ?? "").trim();
  const customSlug = String(formData.get("slug") ?? "").trim();
  if (!creatorName) {
    return { error: "Creator name is required." };
  }

  const slug = slugify(customSlug || creatorName);
  if (RESERVED_TOP_LEVEL_SLUGS.has(slug)) {
    return {
      error: `"${slug}" is a reserved path and can't be used as a creator link — pick a different slug.`,
    };
  }

  const { error } = await supabase.from("creator_referrals").insert({
    creator_name: creatorName,
    slug,
  });

  if (error) {
    return error.code === "23505"
      ? { error: `That slug is already taken — try a different one.` }
      : { error: error.message };
  }

  revalidatePath("/admin");
  return { saved: true };
}

export async function toggleCreatorReferralActive(
  referralId: string,
  active: boolean,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return;

  await supabase.from("creator_referrals").update({ active }).eq("id", referralId);

  revalidatePath("/admin");
}

/**
 * Hard delete — cascades to that link's creator_referral_events
 * (00047_creator_referrals.sql). RLS already restricts this to
 * ADMIN_EMAIL; this check just turns a silent zero-row delete into
 * nothing rather than a misleading success.
 */
export async function deleteCreatorReferral(referralId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return;

  await supabase.from("creator_referrals").delete().eq("id", referralId);

  revalidatePath("/admin");
}
