import { Skeleton } from "@/components/ui/skeleton";
import { BrandLoading } from "@/components/brand/brand-loading";

export default function Loading() {
  return (
    <div className="relative flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-48" /><Skeleton className="h-48" />
      </div>
      <BrandLoading />
    </div>
  );
}
