import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Обновляет пользовательскую сессию Supabase на каждом запросе и прокидывает
 * обновлённые cookies в ответ. Вызывается из корневого middleware.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Оптимизация: getSession() читает токен из cookie БЕЗ сетевого запроса и
  // обращается к Supabase только когда access-токен истёк (ленивый refresh).
  // Раньше здесь стоял getUser() — +~226 мс сети на КАЖДЫЙ переход.
  // Безопасность не ослаблена: авторизацию решают страницы (getUser с
  // серверной валидацией, кеширован на запрос) и RLS в БД; middleware лишь
  // поддерживает cookie сессии свежей.
  await supabase.auth.getSession();

  return supabaseResponse;
}
