"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  VEHICLE_TYPE_LABELS_PLURAL,
  vehicleTypeLabel,
  type Vehicle,
  type VehicleType,
} from "@/lib/domain";

interface VehiclePickerProps {
  vehicles: Vehicle[];
  onSelect: (vehicle: Vehicle) => void;
  disabled?: boolean;
  /** Подпись под гос. номером в плитке. */
  sub?: "type" | "brand";
  /** Крупные плитки для «одно касание в перчатках» (экран рейсов). */
  large?: boolean;
  emptyText?: string;
  /** Текст, когда список пуст ещё ДО фильтров (вся техника разобрана и т.п.). */
  noVehiclesText?: string;
  /** Элемент справа от строки поиска (например, кнопка QR). */
  searchTrailing?: ReactNode;
  /** Элемент в правой части каждой плитки (например, ✕ для снятия). */
  tileTrailing?: ReactNode;
  /** Инфо-блок в правой части плитки, зависящий от машины (счётчик рейсов и т.п.). */
  tileInfo?: (vehicle: Vehicle) => ReactNode;
  /** Закрепить фильтры (вкладки + поиск) под шапкой при листании длинного списка. */
  stickyFilters?: boolean;
  /** Блок над вкладками внутри закреплённой области (например, источник топлива). */
  header?: ReactNode;
}

/**
 * Единый выбор машины для экранов ввода: вкладки по типам техники
 * (скрываются, если тип один) + поиск + сетка крупных кнопок.
 */
export function VehiclePicker({
  vehicles,
  onSelect,
  disabled,
  sub = "type",
  large = false,
  emptyText = "Ничего не найдено",
  noVehiclesText,
  searchTrailing,
  tileTrailing,
  tileInfo,
  stickyFilters = false,
  header,
}: VehiclePickerProps) {
  const [type, setType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const types = useMemo(
    () =>
      (Object.keys(VEHICLE_TYPE_LABELS_PLURAL) as VehicleType[]).filter((t) =>
        vehicles.some((v) => v.vehicle_type === t),
      ),
    [vehicles],
  );
  const effType = type !== "all" && types.includes(type as VehicleType) ? type : "all";
  const q = search.trim().toLowerCase();
  const shown = vehicles.filter(
    (v) =>
      (effType === "all" || v.vehicle_type === effType) &&
      (q === "" ||
        v.reg_number.toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        className={
          stickyFilters
            ? "sticky top-[var(--app-sticky-top)] z-20 flex flex-col gap-2 bg-background pb-2"
            : "flex flex-col gap-2"
        }
      >
        {header}
        {types.length > 1 ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <TypeChip label="Все" active={effType === "all"} onClick={() => setType("all")} />
            {types.map((t) => (
              <TypeChip
                key={t}
                label={VEHICLE_TYPE_LABELS_PLURAL[t]}
                active={effType === t}
                onClick={() => setType(t)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Input
            placeholder="Гос. номер или марка"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12"
          />
          {searchTrailing}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {shown.map((v) => (
          <button
            key={v.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(v)}
            className={`flex ${large ? "min-h-20" : "min-h-16"} items-center justify-between rounded-lg border p-3 text-left active:bg-accent`}
          >
            <span className="min-w-0">
              <span className={`block truncate font-bold tracking-tight ${large ? "text-xl" : "text-lg"}`}>
                {v.reg_number}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {sub === "brand" ? v.brand : vehicleTypeLabel(v.vehicle_type)}
              </span>
            </span>
            {tileInfo?.(v)}
            {tileTrailing}
          </button>
        ))}
        {shown.length === 0 ? (
          <p className="col-span-2 text-sm text-muted-foreground">
            {vehicles.length === 0 && noVehiclesText ? noVehiclesText : emptyText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full border px-3 text-sm font-medium ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background active:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
