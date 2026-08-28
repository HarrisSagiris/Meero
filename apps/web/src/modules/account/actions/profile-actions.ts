"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string; saved?: boolean };

export async function updateDisplayName(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) {
    return { error: "Name can't be empty." };
  }
  if (displayName.length > 80) {
    return { error: "Name is too long (80 character max)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired — reload and sign in again." };

  // RLS: owner can update their own profile; display_name/avatar_url are
  // the only self-editable fields (billing/credit columns are trigger-protected).
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { saved: true };
}
