import { cn } from "@/lib/utils";
import { WagMonogram } from "@/components/brand/logo-mark";

/**
 * Оверлей на скелетоны загрузки: фирменный треугольник WAG вращается
 * «монеткой» (rotateY) с мягким свечением. Класть внутрь relative-контейнера.
 */
export function BrandLoading({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex items-center justify-center", className)}>
      <div className="[perspective:800px]">
        <WagMonogram className="brand-spin h-14 w-16 text-primary" />
      </div>
    </div>
  );
}
