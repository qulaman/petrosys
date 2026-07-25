"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getSignedUrlAction } from "@/app/fleet/journals/actions";
import { unexpectedError } from "@/lib/db-error";

/** Открывает приватный файл (чек/подпись) по signed URL. */
export function AttachmentLink({
  bucket,
  path,
  label,
}: {
  bucket: "signatures" | "receipts";
  path: string | null;
  label: string;
}) {
  const [loading, setLoading] = useState(false);
  if (!path) return <span className="text-xs text-muted-foreground">—</span>;

  async function open() {
    setLoading(true);
    try {
      const res = await getSignedUrlAction(bucket, path!);
      // Молча ничего не делать нельзя: пользователь решит, что нажатие не сработало.
      if ("url" in res) window.open(res.url, "_blank", "noopener");
      else toast.error(res.error ?? "Файл недоступен");
    } catch (e) {
      toast.error(unexpectedError("attachment-link", e, "Не удалось открыть файл"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={open} disabled={loading} className="text-xs text-primary underline disabled:opacity-50">
      {loading ? "…" : label}
    </button>
  );
}
