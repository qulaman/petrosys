import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { QrStickers } from "./qr-stickers";

export default async function QrPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select("id, reg_number, brand, vehicle_type, qr_code")
    .eq("is_active", true)
    .order("reg_number");

  return (
    <AppShell requiredRoles={["admin", "office"]} title="QR-наклейки на технику">
      <QrStickers
        vehicles={
          (data ?? []) as {
            id: string;
            reg_number: string;
            brand: string;
            vehicle_type: string;
            qr_code: string | null;
          }[]
        }
      />
    </AppShell>
  );
}
