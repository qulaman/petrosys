/** Типы и подписи справочника АВР, общие для сервера и клиента (без server-only). */

export type DocType = "contract" | "addendum" | "manual";

export const DOC_LABELS: Record<DocType, string> = {
  contract: "договор",
  addendum: "доп. соглашение",
  manual: "ручной ввод",
};

export interface RateVersion {
  valid_from: string;
  hour: number | null;
  trip: number | null;
  fuel: number | null;
  doc_type: DocType | null;
  current: boolean;
}

export interface RegistryVehicle {
  id: string;
  reg_number: string;
  vehicle_type: string;
  contract_number: string | null;
  day_driver: string | null;
  night_driver: string | null;
  versions: RateVersion[];
}

export interface RegistryGroup {
  contractor_id: string;
  contractor: string;
  vat_payer: boolean;
  vehicles: RegistryVehicle[];
}

export interface UnassignedVehicle {
  id: string;
  reg_number: string;
  vehicle_type: string;
  reason: string;
}

export interface RegistryData {
  groups: RegistryGroup[];
  unassigned: UnassignedVehicle[];
  contractors: { id: string; name: string; vat_payer: boolean }[];
  contracts: { id: string; number: string; contractor_id: string }[];
  drivers: { id: string; full_name: string }[];
}
