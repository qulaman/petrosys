/**
 * Доменные типы и справочные подписи (пока БД-типы не сгенерированы).
 * Значения соответствуют check-ограничениям миграций.
 */

export type VehicleType =
  | "dump_truck"
  | "grader"
  | "excavator"
  | "dozer"
  | "roller"
  | "water_truck"
  | "loader"
  | "other";

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  dump_truck: "Самосвал",
  grader: "Грейдер",
  excavator: "Экскаватор",
  dozer: "Бульдозер",
  roller: "Каток",
  water_truck: "Водовоз",
  loader: "Погрузчик",
  other: "Прочее",
};

/** Множественные подписи — для вкладок-фильтров по типу техники. */
export const VEHICLE_TYPE_LABELS_PLURAL: Record<VehicleType, string> = {
  dump_truck: "Автосамосвалы",
  grader: "Грейдеры",
  excavator: "Экскаваторы",
  dozer: "Бульдозеры",
  roller: "Катки",
  water_truck: "Водовозы",
  loader: "Погрузчики",
  other: "Прочее",
};

export type AccountingType = "hours" | "trips";
export type FuelSourceType = "card" | "tanker";

export interface FuelCard {
  id: string;
  card_number: string;
  operator: string | null;
}

export interface Tanker {
  id: string;
  name: string;
  capacity_liters: number | null;
}

export interface TankerBalance {
  tanker_id: string;
  name: string;
  calculated_liters: number;
  last_measured_liters: number | null;
  last_measured_at: string | null;
}

export interface Vehicle {
  id: string;
  brand: string;
  reg_number: string;
  vehicle_type: VehicleType;
  accounting_type: AccountingType;
  contractor_id: string | null;
  contract_id: string | null;
  qr_code: string | null;
  /** Штатные водители из справочника АВР — подстановка по умолчанию в формах. */
  day_driver_id?: string | null;
  night_driver_id?: string | null;
}

export interface Driver {
  id: string;
  full_name: string;
  contractor_id: string | null;
  contract_id: string | null;
}

/**
 * Пул водителей для машины: сначала водители того же ДОГОВОРА (Приложение №2),
 * затем того же подрядчика, иначе все. Пустые ступени пропускаются.
 */
export function driverPoolFor<
  D extends { contractor_id: string | null; contract_id: string | null },
>(
  vehicle: { contractor_id: string | null; contract_id: string | null } | null | undefined,
  drivers: D[],
): D[] {
  if (!vehicle) return drivers;
  if (vehicle.contract_id) {
    const byContract = drivers.filter((d) => d.contract_id === vehicle.contract_id);
    if (byContract.length) return byContract;
  }
  if (vehicle.contractor_id) {
    const byContractor = drivers.filter((d) => d.contractor_id === vehicle.contractor_id);
    if (byContractor.length) return byContractor;
  }
  return drivers;
}

export function vehicleTypeLabel(t: string): string {
  return VEHICLE_TYPE_LABELS[t as VehicleType] ?? t;
}
