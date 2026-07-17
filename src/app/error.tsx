"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { devError } from "@/lib/dev-log";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    devError("route-error", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <p className="font-medium">Что-то пошло не так</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Ошибка при загрузке раздела. Попробуйте ещё раз.
      </p>
      <Button onClick={reset}>Повторить</Button>
    </div>
  );
}
