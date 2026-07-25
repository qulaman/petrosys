"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { devError } from "@/lib/dev-log";

/**
 * Граница ошибок рабочих экранов. Корневая error.tsx оставляет пользователя
 * на пустой странице без единой ссылки — здесь всегда есть выход на главную.
 */
export default function FleetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    devError("fleet-error", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <p className="text-lg font-medium">Раздел не открылся</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Данные не удалось загрузить. Обычно помогает повторная попытка — данные учёта при этом не теряются.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button size="lg" onClick={reset}>Повторить</Button>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          На главную
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">Код ошибки: {error.digest}</p>
      ) : null}
    </div>
  );
}
