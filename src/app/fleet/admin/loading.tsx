import { Skeleton } from "@/components/ui/skeleton";
import { BrandLoading } from "@/components/brand/brand-loading";

/** Скелетон хаба справочников: секции с плитками (счётчики считаются на сервере). */
export default function Loading() {
  return (
    <div className="relative flex flex-1 flex-col gap-6 p-4">
      <Skeleton className="h-8 w-56" />
      {[3, 3, 4].map((cards, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: cards }, (_, j) => (
              <Skeleton key={j} className="h-[76px] w-full" />
            ))}
          </div>
        </div>
      ))}
      <BrandLoading />
    </div>
  );
}
