import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { homePathForRoles } from "@/lib/auth/roles";

/**
 * Корневой диспетчер: не вошёл → /login; вошёл → рабочий экран его роли.
 */
export default async function Home() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (!current.profile) redirect("/no-access");
  redirect(homePathForRoles(current.profile.roles));
}
