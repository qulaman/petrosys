import { Mountain } from "lucide-react";
import { cn } from "@/lib/utils";

/** Вордмарк QuarryOps: оранжевый знак + название. */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <Mountain className="size-4" />
      </span>
      {!compact ? (
        <span className="text-base font-bold tracking-tight">
          Quarry<span className="text-primary">Ops</span>
        </span>
      ) : null}
    </span>
  );
}
