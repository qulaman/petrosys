import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { BackButton } from "@/components/back-button";
import { NavBar, TitleIcon, type NavItem } from "@/components/nav-bar";
import { ru } from "@/lib/i18n/ru";

const NAV: NavItem[] = [
  { href: "/portal", label: "Главная", icon: "home", exact: true },
  { href: "/portal/trips", label: "Рейсы", icon: "trips" },
  { href: "/portal/shifts", label: "Смены", icon: "shifts" },
  { href: "/portal/fuel", label: "Топливо", icon: "fuel" },
  { href: "/portal/documents", label: "Документы", icon: "documents" },
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

      <NavBar items={NAV} variant="top" />

      <main className="flex-1 p-4">
        <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <BackButton />
          <TitleIcon />
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}
