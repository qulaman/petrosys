import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-20" /><Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
