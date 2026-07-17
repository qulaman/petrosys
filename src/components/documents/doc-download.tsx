"use client";

import { useState } from "react";
import { getDocumentUrl } from "@/app/fleet/office/documents/actions";

export function DocDownload({ docId }: { docId: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    try {
      const r = await getDocumentUrl(docId);
      if ("url" in r) window.open(r.url, "_blank", "noopener");
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
