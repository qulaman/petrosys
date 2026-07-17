import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ru } from "@/lib/i18n/ru";

const NAV = [
  { href: "/portal", label: "Главная" },
  { href: "/portal/trips", label: "Рейсы" },
  { href: "/portal/shifts", label: "Смены" },
  { href: "/portal/fuel", label: "Топливо" },
  { href: "/portal/documents", label: "Документы" },
];

/** Отдельный layout портала подрядчика (read-only, роль contractor). */
export async function PortalShell({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (!current.profile || !current.profile.roles.includes("contractor")) redirect("/");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            Кабинет подрядчика · {current.profile.full_name ?? current.email}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">{ru.common.signOut}</Button>
          </form>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {n.label}
          </Link>
        ))}
      </nav>

      <main className="flex-1 p-4">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
