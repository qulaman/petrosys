"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { devError } from "@/lib/dev-log";

/** Граница ошибок портала подрядчика. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    devError("portal-error", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <p className="text-lg font-medium">Не удалось загрузить данные</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Попробуйте ещё раз. Если повторяется — сообщите в офис West Arlan Group.
      </p>
      <Button size="lg" className="mt-2" onClick={reset}>Повторить</Button>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">Код ошибки: {error.digest}</p>
      ) : null}
    </div>
  );
}
