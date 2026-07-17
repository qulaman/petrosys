import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type Bucket = "signatures" | "receipts";

/**
 * Signed URL для приватного объекта (просмотр офисом). Генерируется на сервере
 * через service_role — минует RLS. По умолчанию действует 1 час.
 */
export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
