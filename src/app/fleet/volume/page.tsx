import Link from "next/link";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { aqtobeToday } from "@/lib/tz";
import { VolumeForm } from "./volume-form";

export const metadata = { title: "Объём — сводки" };

/**
 * Ввод дневных сводок геодезиста (м³). Список, правки и выгрузка живут
 * в журнале объёма — здесь только быстрый ввод с телефона.
 */
export default async function VolumePage() {
  return (
    <AppShell requiredRoles={["itr", "office", "admin"]} title="Объём — сводки">
      <div className="flex flex-col gap-4">
        <VolumeForm today={aqtobeToday()} />
        <Link
          href="/fleet/journals/volume"
          className="flex items-center gap-2 rounded-lg border p-4 font-medium hover:bg-accent"
        >
          <BookOpen className="size-5 text-muted-foreground" />
          Журнал объёма — все сводки, правка и выгрузка
        </Link>
      </div>
    </AppShell>
  );
}
