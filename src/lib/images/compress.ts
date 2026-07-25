"use client";

import { devError, devLog } from "@/lib/dev-log";

/** Длинная сторона после сжатия: чек с АЗС читается и в 1600 px. */
const MAX_SIDE = 1600;
const QUALITY = 0.72;

/**
 * Сжатие фото чека перед отправкой и постановкой в очередь.
 *
 * Камера телефона отдаёт 2–4 МБ на снимок. В онлайне это лишние секунды на
 * слабой связи, а в очереди — балласт в хранилище. После пересжатия чек весит
 * 150–400 КБ и остаётся читаемым.
 *
 * Если браузер не тянет (нет createImageBitmap, файл не картинка, ошибка
 * декодирования) — возвращаем оригинал: лучше тяжёлый чек, чем никакого.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    // Картинка уже мелкая и лёгкая — пересжатие только испортит.
    if (scale === 1 && file.size < 600_000) {
      bitmap.close();
      return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    devLog("compress", `${Math.round(file.size / 1024)} КБ → ${Math.round(blob.size / 1024)} КБ`);
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (e) {
    devError("compress", "не удалось сжать изображение:", e);
    return file;
  }
}
