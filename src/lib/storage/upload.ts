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

/**
 * Сжатие фото на телефоне перед загрузкой: длинная сторона ≤ maxSide,
 * JPEG ~q0.8 — чек остаётся читаемым, но ~250 КБ вместо 1–4 МБ с камеры.
 * Любая ошибка сжатия → оригинал (запись важнее оптимизации).
 */
async function compressImage(
  file: File,
  maxSide = 1600,
  quality = 0.8,
): Promise<{ blob: Blob; ext: string; type: string }> {
  const original = {
    blob: file as Blob,
    ext: file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg",
    type: file.type || "image/jpeg",
  };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    // Если выигрыша нет (уже маленький файл) — оставляем оригинал.
    if (!blob || blob.size >= file.size) return original;
    return { blob, ext: "jpg", type: "image/jpeg" };
  } catch {
    return original;
  }
}

/** Загружает фото чека (со сжатием на клиенте). Возвращает путь в бакете receipts. */
export async function uploadReceipt(orgId: string, file: File): Promise<string> {
  const supabase = createClient();
  const { blob, ext, type } = await compressImage(file);
  const path = objectPath(orgId, ext);
  const { error } = await supabase.storage.from("receipts").upload(path, blob, {
    contentType: type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}
