import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { ForecastForm } from "./forecast-form";

export default async function ForecastSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("forecast_settings").select("*").maybeSingle();

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Параметры прогноза">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Якорь и цель для вкладки «Объём» дашборда. Вводится один раз, дальше — правки по необходимости.
        </p>
        <ForecastForm
          initial={{
            baseline_date: data?.baseline_date ?? "2026-07-01",
            baseline_volume_m3: Number(data?.baseline_volume_m3 ?? 150000),
            target_volume_m3: Number(data?.target_volume_m3 ?? 500000),
            target_date: data?.target_date ?? null,
            trucks_per_excavator: data?.trucks_per_excavator ?? 10,
            availability_coeff: Number(data?.availability_coeff ?? 0.75),
            trips_per_truck_shift: data?.trips_per_truck_shift ?? 15,
          }}
        />
      </div>
    </AppShell>
  );
}
