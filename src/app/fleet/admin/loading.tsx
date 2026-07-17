import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-56" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
