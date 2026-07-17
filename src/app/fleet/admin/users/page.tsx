import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { loadUsers } from "@/lib/data/users";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const current = await getCurrentProfile();
  if (!current?.profile) redirect("/login");
  // Управление пользователями — только admin.
  if (!current.profile.roles.includes("admin")) redirect("/fleet/admin");

  const data = await loadUsers(current.profile.org_id);

  return (
    <AppShell requiredRoles={["admin"]} title="Пользователи и роли">
      <UsersClient data={data} />
    </AppShell>
  );
}
