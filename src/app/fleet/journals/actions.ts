"use server";

import { getSignedUrl } from "@/lib/storage/signed-url";
import { getCurrentProfile } from "@/lib/auth/current-user";

type Bucket = "signatures" | "receipts";

/** Signed URL для просмотра чека/подписи. Только office/admin. */
export async function getSignedUrlAction(
  bucket: Bucket,
  path: string,
): Promise<{ url: string } | { error: string }> {
  const cur = await getCurrentProfile();
  if (!cur?.profile) return { error: "Нет доступа" };
  if (!cur.profile.roles.some((r) => r === "office" || r === "admin"))
    return { error: "Нет доступа" };

  const url = await getSignedUrl(bucket, path);
  return url ? { url } : { error: "Файл не найден" };
}
