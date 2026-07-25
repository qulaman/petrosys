"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getDocumentUrl } from "@/app/fleet/office/documents/actions";
import { unexpectedError } from "@/lib/db-error";

export function DocDownload({ docId }: { docId: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    try {
      const r = await getDocumentUrl(docId);
      // Молча ничего не делать нельзя: нажатие выглядит как «кнопка не работает».
      if ("url" in r) window.open(r.url, "_blank", "noopener");
      else toast.error(r.error ?? "Документ недоступен");
    } catch (e) {
      toast.error(unexpectedError("doc-download", e, "Не удалось открыть документ"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <button onClick={open} disabled={loading} className="text-sm text-primary underline disabled:opacity-50">
      {loading ? "…" : "Скачать"}
    </button>
  );
}
