import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo-mark";

/** Вордмарк Arlan Ops: оранжевый знак-треугольник + название. */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <LogoMark className="size-4" />
      </span>
      {!compact ? (
        <span className="text-base font-bold tracking-tight">
          Arlan&nbsp;<span className="text-primary">Ops</span>
        </span>
      ) : null}
    </span>
  );
}
