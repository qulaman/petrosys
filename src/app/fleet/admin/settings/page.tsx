import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export default async function DetectorSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_settings")
    .select("tanker_gap_liters, no_fuel_days_trips, no_fuel_days_trips_single, no_fuel_days_hours")
    .maybeSingle();

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Настройки детекторов">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Пороги срабатывания детекторов аномалий. Изменения применяются при следующем пересчёте.
        </p>
        <SettingsForm
          initial={{
            tanker_gap_liters: Number(data?.tanker_gap_liters ?? 20),
            no_fuel_days_trips: data?.no_fuel_days_trips ?? 2,
            no_fuel_days_trips_single: data?.no_fuel_days_trips_single ?? 3,
            no_fuel_days_hours: data?.no_fuel_days_hours ?? 5,
          }}
        />
      </div>
    </AppShell>
  );
}
