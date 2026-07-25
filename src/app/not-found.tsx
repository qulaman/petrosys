import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 по-русски. Без этого файла Next показывает свою английскую страницу —
 * в том числе на notFound() из админки договоров и при заходе на /fleet.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Compass className="size-8 text-muted-foreground" />
      <p className="text-lg font-medium">Страница не найдена</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Такого раздела нет или запись была удалена. Проверьте адрес или вернитесь на главную.
      </p>
      <Link href="/" className={buttonVariants({ size: "lg", className: "mt-2" })}>
        На главную
      </Link>
    </div>
  );
}
