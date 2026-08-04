"use client";

import { useState } from "react";
import { Download } from "lucide-react";
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
    // Значок тот же, что у выгрузок CSV в журналах: одно действие — один вид.
    <button
      onClick={open}
      disabled={loading}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline disabled:opacity-50"
    >
      <Download className="size-4 shrink-0" />
      {loading ? "…" : "Скачать"}
    </button>
  );
}
