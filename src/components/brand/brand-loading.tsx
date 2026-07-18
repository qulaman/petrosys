import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo-mark";

/**
 * Оверлей на скелетоны загрузки: знак Arlan Ops, уступы которого «строятся»
 * снизу вверх. Класть внутрь relative-контейнера со скелетонами.
 */
export function BrandLoading({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex items-center justify-center", className)}>
      <LogoMark animated className="size-16 text-primary drop-shadow-sm" />
    </div>
  );
}
