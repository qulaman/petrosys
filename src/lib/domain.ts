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

export type AccountingType = "hours" | "trips" | "both";
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

interface DriverPoolVehicle {
  contractor_id: string | null;
  contract_id: string | null;
  day_driver_id?: string | null;
  night_driver_id?: string | null;
}

/**
 * Пул водителей для машины: штатные (день/ночь из справочника АВР) → водители
 * того же договора → того же подрядчика → иначе все. Пустые ступени пропускаются.
 */
export function driverPoolFor<
  D extends { id: string; contractor_id: string | null; contract_id: string | null },
>(vehicle: DriverPoolVehicle | null | undefined, drivers: D[]): D[] {
  if (!vehicle) return drivers;
  const staff = drivers.filter(
    (d) => d.id === vehicle.day_driver_id || d.id === vehicle.night_driver_id,
  );
  const byContract = vehicle.contract_id
    ? drivers.filter((d) => d.contract_id === vehicle.contract_id)
    : [];
  const byContractor = vehicle.contractor_id
    ? drivers.filter((d) => d.contractor_id === vehicle.contractor_id)
    : [];
  const pool = [...new Set([...staff, ...byContract, ...byContractor])];
  return pool.length ? pool : drivers;
}

/**
 * Группы для селектов водителя (сквозной подход): «свои» водители машины
 * (штатные/договор/ИП) и остальные. Если привязок нет — primary пустой,
 * UI показывает общий список.
 */
export function driverGroups<
  D extends { id: string; contractor_id: string | null; contract_id: string | null },
>(vehicle: DriverPoolVehicle | null | undefined, drivers: D[]): { primary: D[]; rest: D[] } {
  const pool = driverPoolFor(vehicle, drivers);
  if (pool.length === drivers.length) return { primary: [], rest: drivers };
  const inPool = new Set(pool.map((d) => d.id));
  return { primary: pool, rest: drivers.filter((d) => !inPool.has(d.id)) };
}

export function vehicleTypeLabel(t: string): string {
  return VEHICLE_TYPE_LABELS[t as VehicleType] ?? t;
}
