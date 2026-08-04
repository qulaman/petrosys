import { NextResponse } from "next/server";
import { BUILD_SHA, BUILD_TIME } from "@/lib/build-info";

/**
 * Метка сборки, которая сейчас обслуживает запросы. Клиент сравнивает её с
 * той, что зашита в его бандл: расхождение = телефон крутит старый код.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { sha: BUILD_SHA, builtAt: BUILD_TIME },
    // Без no-store ответ осел бы в кеше ровно тогда, когда он и нужен свежим.
    { headers: { "cache-control": "no-store" } },
  );
}
