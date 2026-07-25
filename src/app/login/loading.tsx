import { Skeleton } from "@/components/ui/skeleton";

/**
 * Свой скелетон входа: иначе на /login показывался корневой дашбордный
 * (полоса плиток и большой график) — для формы из двух полей это выглядит дико.
 */
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Skeleton className="mx-auto h-10 w-40" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
