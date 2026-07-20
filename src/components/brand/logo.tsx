import { cn } from "@/lib/utils";
import { WagMonogram } from "@/components/brand/logo-mark";

/** Вордмарк Arlan Ops: фирменный треугольник WAG на оранжевой плашке + название. */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <WagMonogram className="h-4 w-[18px]" />
      </span>
      {!compact ? (
        <span className="text-base font-bold tracking-tight">
          Arlan&nbsp;<span className="text-primary">Ops</span>
        </span>
      ) : null}
    </span>
  );
}
