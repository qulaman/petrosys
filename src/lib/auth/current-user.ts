import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface CurrentProfile {
  id: string;
  full_name: string | null;
  roles: string[];
  org_id: string;
  contractor_id: string | null;
}

/**
 * Текущий пользователь и его профиль (серверная сторона).
 * Возвращает null, если не аутентифицирован.
 * Обёрнуто в React.cache — в рамках одного HTTP-запроса выполняется один раз
 * (загрузчик данных и AppShell раньше дублировали 2 сетевых захода ≈ 450 мс).
 */
export const getCurrentProfile = cache(async (): Promise<{
  userId: string;
  email: string | undefined;
  profile: CurrentProfile | null;
} | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, roles, org_id, contractor_id")
    .eq("id", user.id)
    .single();

  return {
    userId: user.id,
    email: user.email,
    profile: (profile as CurrentProfile) ?? null,
  };
});
