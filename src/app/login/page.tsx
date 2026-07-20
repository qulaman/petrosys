import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { WagMonogram } from "@/components/brand/logo-mark";
import { LoginForm } from "./login-form";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { homePathForRoles } from "@/lib/auth/roles";
import { ru } from "@/lib/i18n/ru";

export default async function LoginPage() {
  // Уже вошедших сразу на их рабочий экран.
  const current = await getCurrentProfile();
  if (current?.profile) {
    redirect(homePathForRoles(current.profile.roles));
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      {/* Фирменный фон: мягкое свечение сверху + крупная полупрозрачная монограмма */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_-10%,color-mix(in_srgb,var(--primary)_14%,transparent),transparent)]"
      />
      <WagMonogram className="pointer-events-none absolute -bottom-24 -right-28 h-[420px] w-[476px] text-primary/[0.06]" />
      <div className="relative flex justify-end p-4">
        <ThemeToggle />
      </div>
      <div className="relative flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <WagMonogram className="mx-auto mb-2 h-14 w-16 text-primary" />
            <p className="mb-2 text-xl font-bold tracking-tight">
              Arlan <span className="text-primary">Ops</span>
            </p>
            <CardTitle className="text-2xl">{ru.auth.loginTitle}</CardTitle>
            <CardDescription>{ru.auth.loginSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
