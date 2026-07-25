import { Skeleton } from "@/components/ui/skeleton";
import { BrandLoading } from "@/components/brand/brand-loading";

/** Скелетон экрана «Объём»: форма сводки + список последних записей. */
export default function Loading() {
  return (
    <div className="relative flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-56 w-full" />
      <BrandLoading />
    </div>
  );
}
