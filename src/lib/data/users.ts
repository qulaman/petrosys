import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AppUser {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: string[];
  contractor_id: string | null;
}

export interface UsersScreenData {
  users: AppUser[];
  contractors: { id: string; name: string }[];
}

/** Список пользователей организации (профиль + email из auth). Только admin. */
export async function loadUsers(orgId: string): Promise<UsersScreenData> {
  const admin = createAdminClient();

  const [{ data: profiles }, { data: contractors }, listed] = await Promise.all([
    admin.from("profiles").select("id, full_name, roles, contractor_id").eq("org_id", orgId),
    admin.from("contractors").select("id, name").eq("org_id", orgId).eq("is_active", true).order("name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const emailById = new Map<string, string | null>();
  for (const u of listed.data?.users ?? []) emailById.set(u.id, u.email ?? null);

  const users: AppUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    full_name: p.full_name,
    roles: p.roles ?? [],
    contractor_id: p.contractor_id,
  }));
  users.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "ru"));

  return {
    users,
    contractors: (contractors ?? []) as { id: string; name: string }[],
  };
}
