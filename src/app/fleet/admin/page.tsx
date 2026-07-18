import Link from "next/link";
import { QrCode, Users, FileSignature, FileType2, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { ENTITIES, ENTITY_ORDER } from "@/lib/admin/registry";

export default async function AdminHome() {
  const current = await getCurrentProfile();
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Справочники">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/fleet/admin/contracts"
          className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
        >
          <FileSignature className="size-5" /> Договоры и прайсы
        </Link>
        <Link
          href="/fleet/admin/templates"
          className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
        >
          <FileType2 className="size-5" /> Шаблоны документов
        </Link>
        {ENTITY_ORDER.map((slug) => (
          <Link
            key={slug}
            href={`/fleet/admin/${slug}`}
            className="rounded-lg border p-4 font-medium hover:bg-accent"
          >
            {ENTITIES[slug].title}
          </Link>
        ))}
        <Link
          href="/fleet/admin/qr"
          className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
        >
          <QrCode className="size-5" /> QR-наклейки на технику
        </Link>
        <Link
          href="/fleet/admin/settings"
          className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
        >
          <SlidersHorizontal className="size-5" /> Настройки детекторов
        </Link>
        {isAdmin ? (
          <Link
            href="/fleet/admin/users"
            className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
          >
            <Users className="size-5" /> Пользователи и роли
          </Link>
        ) : null}
      </div>
    </AppShell>
  );
}
