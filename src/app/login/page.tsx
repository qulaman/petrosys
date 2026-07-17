import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/brand/logo";
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
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <Logo className="mb-2" />
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
