"use client";

import { useEffect, useRef, useState } from "react";
import { getSignedUrlsAction } from "@/app/fleet/journals/actions";

/**
 * Миниатюры подписей в журналах: подписанные ссылки берутся ПАЧКОЙ одним
 * запросом на страницу (хук), в ячейке — сама подпись (SVG ~2 КБ), клик — крупно.
 */
export function useSignedUrls(bucket: "signatures" | "receipts", paths: (string | null)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Уже запрошенные пути — ref трогается только внутри эффекта.
  const requestedRef = useRef<Set<string>>(new Set());
  const key = paths.filter(Boolean).sort().join("|");

  useEffect(() => {
    const need = [...new Set(paths.filter((p): p is string => !!p))].filter((p) => !requestedRef.current.has(p));
    if (!need.length) return;
    for (const p of need) requestedRef.current.add(p);
    void getSignedUrlsAction(bucket, need).then((res) => {
      if ("urls" in res) setUrls((prev) => ({ ...prev, ...res.urls }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paths сведён к строковому ключу
  }, [bucket, key]);

  return urls;
}

export function SignatureThumb({
  path,
  urls,
  title = "Открыть подпись",
}: {
  path: string | null;
  urls: Record<string, string>;
  title?: string;
}) {
  if (!path) return <span className="text-xs text-muted-foreground">—</span>;
  const url = urls[path];
  if (!url) return <span className="inline-block h-8 w-16 animate-pulse rounded border bg-muted" aria-label="Подпись загружается" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, обычная картинка */}
      <img src={url} alt="Подпись" className="h-8 w-16 rounded border bg-white object-contain" />
    </a>
  );
}
