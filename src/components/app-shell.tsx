import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { BackButton } from "@/components/back-button";
import { NavBar, TitleIcon, type NavItem } from "@/components/nav-bar";
import { PageHeader } from "@/components/ui/page-header";
import { OutboxIndicator } from "@/components/field/outbox-indicator";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { ru } from "@/lib/i18n/ru";

const NAV: (NavItem & { roles: Role[] })[] = [
  { href: "/fleet/dashboard", label: "Дашборд", icon: "dashboard", roles: ["admin", "office"] },
  { href: "/fleet/fuel/issue", label: "Выдача", icon: "fuel", roles: ["fueler", "admin"] },
  { href: "/fleet/fuel/tanker", label: "Бензовоз", icon: "tanker", roles: ["fueler", "admin"] },
  { href: "/fleet/shifts", label: "Табель", icon: "shifts", roles: ["itr", "admin"] },
  { href: "/fleet/volume", label: "Объём", icon: "volume", roles: ["itr", "office", "admin"] },
  { href: "/fleet/trips", label: "Рейсы", icon: "trips", roles: ["checker", "admin"] },
  { href: "/fleet/journals", label: "Журналы", icon: "journals", roles: ["office", "admin"] },
  { href: "/fleet/office/settlement", label: "Закрытие", icon: "settlement", roles: ["office", "admin"] },
  { href: "/fleet/office/documents", label: "Документы", icon: "documents", roles: ["office", "admin"] },
  { href: "/fleet/admin", label: "Справочники", icon: "admin", roles: ["admin", "office"] },
];

/**
 * Каркас аутентифицированного экрана: шапка (имя, роли, тема, выход) + контент.
 * Проверяет вход и, если заданы requiredRoles, наличие хотя бы одной из них.
 */
export async function AppShell({
  requiredRoles,
  title,
  description,
  actions,
  children,
}: {
  requiredRoles?: Role[];
  title: string;
  /** Пояснение под заголовком — что это за экран и как им пользоваться. */
  description?: string;
  /** Действия уровня экрана (выгрузка, «создать») — справа от заголовка. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (!current.profile) redirect("/no-access");

  const roles = current.profile.roles;
  if (requiredRoles && !requiredRoles.some((r) => roles.includes(r))) {
    redirect("/");
  }

  const roleLabels = roles
    .map((r) => ROLE_LABELS[r as Role])
    .filter(Boolean)
    .join(", ");

  // Офисные роли — верхняя навигация (desktop); чисто полевые — нижний tab-bar (thumb-zone).
  const isOffice = roles.includes("office") || roles.includes("admin");
  const navItems: NavItem[] = NAV.filter((n) => n.roles.some((r) => roles.includes(r))).map(
    ({ href, label, icon }) => ({ href, label, icon }),
  );

  const showTopNav = isOffice && navItems.length > 1;
  // Tab-bar из одного пункта — плашка на весь экран ради единственной кнопки;
  // у checker'а так и было. Один пункт — навигация не нужна.
  const showBottomNav = !isOffice && navItems.length > 1;

  return (
    <div
      className="flex min-h-full flex-1 flex-col"
      style={
        {
          // Суммарная высота закреплённой шапки — от неё отталкиваются нижние sticky-уровни.
          // В rem, а не в px: сама шапка — h-14 (3.5rem) плюс меню h-11 (2.75rem),
          // и при увеличенном шрифте/зуме 200% фиксированные пиксели отставали,
          // из-за чего шапка накрывала закреплённые фильтры и шапки таблиц.
          "--app-sticky-top": showTopNav ? "6.25rem" : "3.5rem",
          // Отступ снизу для закреплённых панелей действий: высота tab-bar, если он есть,
          // иначе только безопасная зона. Без этого главная кнопка экрана уходит под меню.
          "--app-bottom-nav": showBottomNav
            ? "calc(4rem + env(safe-area-inset-bottom))"
            : "env(safe-area-inset-bottom)",
        } as React.CSSProperties
      }
    >
      <div className="sticky top-0 z-40 bg-background">
        <header className="flex h-14 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo compact={!isOffice} />
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {current.profile.full_name ?? current.email} · {roleLabels}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <OutboxIndicator className="mr-1" />
            <ThemeToggle />
            <form action={signOut}>
              <Button variant="ghost" size="field" type="submit">
                {ru.common.signOut}
              </Button>
            </form>
          </div>
        </header>

        {showTopNav ? <NavBar items={navItems} variant="top" /> : null}
      </div>

      <main className={cn("flex-1 p-4", showBottomNav ? "pb-24" : "")}>
        <PageHeader
          title={title}
          description={description}
          actions={actions}
          leading={<><BackButton /><TitleIcon /></>}
        />
        {children}
      </main>

      {showBottomNav ? <NavBar items={navItems} variant="bottom" /> : null}
    </div>
  );
}
