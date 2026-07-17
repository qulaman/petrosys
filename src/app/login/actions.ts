"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathForRoles } from "@/lib/auth/roles";
import { ru } from "@/lib/i18n/ru";

export interface LoginState {
  error?: string;
}

export async function signIn(
  _prev: LoginState | null,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: ru.auth.invalidCredentials };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: ru.auth.invalidCredentials };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let roles: string[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("roles")
      .eq("id", user.id)
      .single();
    roles = profile?.roles ?? [];
  }

  // redirect() бросает управляющее исключение — вне try/catch.
  redirect(homePathForRoles(roles));
}
