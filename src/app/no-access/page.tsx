import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { ru } from "@/lib/i18n/ru";

export default function NoAccessPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>{ru.auth.noAccessTitle}</CardTitle>
          <CardDescription>{ru.auth.noAccessText}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button variant="outline" type="submit" className="w-full">
              {ru.common.signOut}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
