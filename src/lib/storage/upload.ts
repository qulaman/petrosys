"use client";

import { createClient } from "@/lib/supabase/client";

/** dataURL (canvas.toDataURL) → Blob для загрузки. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Путь объекта: <org_id>/<yyyy>/<mm>/<uuid>.<ext> — первый сегмент = org (под RLS). */
function objectPath(orgId: string, ext: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${orgId}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

/** Загружает PNG подписи из canvas dataURL. Возвращает путь в бакете signatures. */
export async function uploadSignature(
  orgId: string,
  dataUrl: string,
): Promise<string> {
  const supabase = createClient();
  const path = objectPath(orgId, "png");
  const { error } = await supabase.storage
    .from("signatures")
    .upload(path, dataUrlToBlob(dataUrl), {
      contentType: "image/png",
      upsert: false,
    });
  if (error) throw error;
  return path;
}

/** Загружает фото чека. Возвращает путь в бакете receipts. */
export async function uploadReceipt(orgId: string, file: File): Promise<string> {
  const supabase = createClient();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = objectPath(orgId, ext);
  const { error } = await supabase.storage.from("receipts").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}
