import Link from "next/link";
import { Droplet, ClipboardList, Truck } from "lucide-react";
import { AppShell } from "@/components/app-shell";

const CARDS = [
  { href: "/fleet/journals/fuel", label: "Журнал выдачи ГСМ", icon: Droplet },
  { href: "/fleet/journals/trips", label: "Журнал рейсов", icon: Truck },
  { href: "/fleet/journals/shifts", label: "Журнал смен (табель)", icon: ClipboardList },
];

export default function JournalsHome() {
  return (
    <AppShell requiredRoles={["office", "admin"]} title="Журналы">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="flex items-center gap-3 rounded-lg border p-4 font-medium hover:bg-accent">
            <c.icon className="size-5 text-muted-foreground" />
            {c.label}
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
