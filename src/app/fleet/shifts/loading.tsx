import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-44" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16" /><Skeleton className="h-16" />
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
