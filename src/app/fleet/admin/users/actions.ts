"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { ROLES } from "@/lib/auth/roles";
import { zUuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

/** Гейт: действие доступно только текущему admin своей организации. */
async function requireAdmin(): Promise<
  { ok: true; orgId: string } | { ok: false; error: string }
> {
  const current = await getCurrentProfile();
  if (!current?.profile) return { ok: false, error: "Нет доступа" };
  if (!current.profile.roles.includes("admin"))
    return { ok: false, error: "Только администратор управляет пользователями" };
  return { ok: true, orgId: current.profile.org_id };
}

const roleEnum = z.enum(ROLES);

const createSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Пароль — минимум 6 символов"),
  full_name: z.string().min(1, "Укажите ФИО"),
  roles: z.array(roleEnum).min(1, "Выберите хотя бы одну роль"),
  contractor_id: zUuid.nullable(),
});

export async function createUserAction(
  input: z.infer<typeof createSchema>,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Проверьте поля пользователя" };
  const d = p.data;
  if (d.roles.includes("contractor") && !d.contractor_id)
    return { ok: false, error: "Для роли «Подрядчик» укажите контрагента" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true,
    user_metadata: {
      full_name: d.full_name,
      roles: d.roles,
      org_id: gate.orgId,
      contractor_id: d.contractor_id,
    },
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet/admin/users");
  return { ok: true };
}

const updateSchema = z.object({
  user_id: zUuid,
  full_name: z.string().min(1),
  roles: z.array(roleEnum).min(1),
  contractor_id: zUuid.nullable(),
});

export async function updateUserAction(
  input: z.infer<typeof updateSchema>,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const p = updateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Проверьте поля" };
  const d = p.data;
  if (d.roles.includes("contractor") && !d.contractor_id)
    return { ok: false, error: "Для роли «Подрядчик» укажите контрагента" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: d.full_name,
      roles: d.roles,
      contractor_id: d.contractor_id,
    })
    .eq("id", d.user_id)
    .eq("org_id", gate.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet/admin/users");
  return { ok: true };
}
