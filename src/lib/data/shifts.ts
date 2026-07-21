import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type { Driver, Vehicle } from "@/lib/domain";

export interface WorkType {
  id: string;
  name: string;
}

export type JournalStatus = "draft" | "filling" | "closed";

export interface JournalInfo {
  id: string;
  status: JournalStatus;
  work_type_id: string | null;
  itr_signature_url: string | null;
  closed_at: string | null;
}

export interface JournalLine {
  id: string;
  vehicle_id: string;
  driver_id: string;
  hours: number;
  driver_signature_url: string | null;
}

export interface PreviousJournal {
  id: string;
  shift_date: string;
  shift_type: "day" | "night";
  lineCount: number;
}

export interface ShiftJournalData {
  orgId: string;
  date: string;
  shift: "day" | "night";
  journal: JournalInfo | null;
  lines: JournalLine[];
  vehicles: Vehicle[]; // активная техника на моточасах
  drivers: Driver[];
  workTypes: WorkType[];
  lastDriverByVehicle: Record<string, string>;
  previous: PreviousJournal | null; // источник наследования
}

/** Данные экрана журнала смены для выбранной даты/смены. */
export async function loadShiftJournalData(
  date: string,
  shift: "day" | "night",
): Promise<ShiftJournalData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";

  const supabase = await createClient();
  const [vehiclesRes, driversRes, workTypesRes, journalRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, brand, reg_number, vehicle_type, accounting_type, contractor_id, contract_id, qr_code, day_driver_id, night_driver_id")
      .eq("is_active", true)
      .eq("accounting_type", "hours")
      .order("reg_number"),
    supabase.from("drivers").select("id, full_name, contractor_id, contract_id").eq("is_active", true).order("full_name"),
    supabase.from("work_types").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("shift_journals")
      .select("id, status, work_type_id, itr_signature_url, closed_at")
      .eq("shift_date", date)
      .eq("shift_type", shift)
      .maybeSingle(),
  ]);

  const journal = (journalRes.data as JournalInfo | null) ?? null;

  // Вторая волна — всё параллельно: строки журнала, история водителей,
  // кандидат на наследование (только когда журнала ещё нет).
  const admin = createAdminClient();
  const [linesRes, lastDriverRes, prevRes] = await Promise.all([
    journal
      ? supabase
          .from("shift_records")
          .select("id, vehicle_id, driver_id, hours, driver_signature_url")
          .eq("journal_id", journal.id)
          .order("created_at")
      : Promise.resolve({ data: null }),
    admin
      .from("shift_records")
      .select("vehicle_id, driver_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300),
    !journal
      ? supabase
          .from("shift_journals")
          .select("id, shift_date, shift_type")
          .or(`shift_date.lt.${date},and(shift_date.eq.${date},shift_type.eq.day)`)
          .order("shift_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const lines: JournalLine[] = (linesRes.data ?? []).map((l) => ({
    ...l,
    hours: Number(l.hours),
  }));

  // Источник наследования перечня (самонаследование той же смены исключаем).
  let previous: PreviousJournal | null = null;
  const prev = prevRes.data;
  if (prev && !(prev.shift_date === date && prev.shift_type === shift)) {
    const { count } = await supabase
      .from("shift_records")
      .select("id", { count: "exact", head: true })
      .eq("journal_id", prev.id);
    previous = {
      id: prev.id,
      shift_date: prev.shift_date,
      shift_type: prev.shift_type as "day" | "night",
      lineCount: count ?? 0,
    };
  }

  const lastDriverByVehicle: Record<string, string> = {};
  for (const r of lastDriverRes.data ?? []) {
    if (r.vehicle_id && r.driver_id && !(r.vehicle_id in lastDriverByVehicle)) {
      lastDriverByVehicle[r.vehicle_id] = r.driver_id;
    }
  }

  return {
    orgId,
    date,
    shift,
    journal,
    lines,
    vehicles: (vehiclesRes.data ?? []) as Vehicle[],
    drivers: (driversRes.data ?? []) as Driver[],
    workTypes: (workTypesRes.data ?? []) as WorkType[],
    lastDriverByVehicle,
    previous,
  };
}
