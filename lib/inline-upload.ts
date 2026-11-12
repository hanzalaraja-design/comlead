import { createClient } from "@/lib/supabase/client";

/**
 * Upload a pasted or dropped image and return the link the page uses for it
 * (/api/files/…). Files go under the uploader's own folder.
 */
export async function uploadInlineImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be pasted here.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB.");
  const supabase = createClient();
  // The signed-in session in this browser (no network round trip); Storage checks it again.
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error("You're signed out. Refresh the page and try again.");
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("inline-files").upload(path, file, { contentType: file.type });
  if (error) throw new Error(`Couldn't upload the image: ${error.message}`);
  return `/api/files/inline-files/${path}`;
}

/** The images in a paste or drop, if any. */
export function imagesIn(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.type.startsWith("image/"));
}
