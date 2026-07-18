import { Skeleton } from "@/components/ui/skeleton";
import { BrandLoading } from "@/components/brand/brand-loading";

export default function Loading() {
  return (
    <div className="relative flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-96 w-full" />
      <BrandLoading />
    </div>
  );
}
