"use client";

import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/images/compress";

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

/**
 * Загружает подпись в бакет signatures. Возвращает путь объекта.
 * Основной формат — SVG из SignaturePad (вектор штрихов, ~2 КБ);
 * PNG dataURL принимается как переходный фолбэк для уже открытых вкладок
 * со старой версией приложения.
 */
export async function uploadSignature(
  orgId: string,
  data: string,
): Promise<string> {
  const supabase = createClient();
  const isSvg = data.trimStart().startsWith("<svg");
  const path = objectPath(orgId, isSvg ? "svg" : "png");
  const body = isSvg ? new Blob([data], { type: "image/svg+xml" }) : dataUrlToBlob(data);
  const { error } = await supabase.storage
    .from("signatures")
    .upload(path, body, {
      contentType: isSvg ? "image/svg+xml" : "image/png",
      upsert: false,
    });
  if (error) throw error;
  return path;
}

/** Загружает фото чека (со сжатием на клиенте). Возвращает путь в бакете receipts. */
export async function uploadReceipt(orgId: string, file: File): Promise<string> {
  const supabase = createClient();
  // Повторный вызов на уже сжатом файле ничего не делает — см. compressImage.
  const blob = await compressImage(file);
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = objectPath(orgId, ext);
  const { error } = await supabase.storage.from("receipts").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}
