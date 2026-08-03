"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ru } from "@/lib/i18n/ru";
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
  /**
   * Подтверждение на месте: если для машины возвращён контент, плитка рендерит
   * его вместо обычного содержимого (вопрос + кнопки прямо в сетке, без тостов).
   */
  tileConfirm?: (vehicle: Vehicle) => ReactNode | null;
  /** Закрепить фильтры (вкладки + поиск) под шапкой при листании длинного списка. */
  stickyFilters?: boolean;
  /** Блок над вкладками внутри закреплённой области (например, источник топлива). */
  header?: ReactNode;
  /**
   * Машины, которые нужно поднять в начало списка (сегодня в работе).
   * Именно порядок, а не отдельная вкладка: второй ряд переключателей поверх
   * фильтра по видам техники сбивает — непонятно, какой из них сейчас действует.
   */
  priorityIds?: string[];
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
  emptyText = ru.empty.notFound,
  noVehiclesText,
  searchTrailing,
  tileTrailing,
  tileInfo,
  tileConfirm,
  stickyFilters = false,
  header,
  priorityIds,
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
  /** Список отфильтрован пользователем — значит, у пустого результата есть выход. */
  const filtered = q !== "" || effType !== "all";
  const matched = vehicles.filter(
    (v) =>
      (effType === "all" || v.vehicle_type === effType) &&
      (q === "" ||
        v.reg_number.toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q)),
  );
  // Сортировка устойчивая: внутри групп сохраняется порядок по гос. номеру.
  const priority = useMemo(() => new Set(priorityIds ?? []), [priorityIds]);
  const shown = priority.size
    ? [...matched.filter((v) => priority.has(v.id)), ...matched.filter((v) => !priority.has(v.id))]
    : matched;

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
        {shown.map((v) => {
          const confirm = tileConfirm?.(v);
          if (confirm) {
            return (
              <div
                key={v.id}
                className={`flex ${large ? "min-h-20" : "min-h-16"} items-center rounded-lg border-2 border-primary bg-primary/5 p-2`}
              >
                {confirm}
              </div>
            );
          }
          return (
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
          );
        })}
        {shown.length === 0 ? (
          // Пустой парк и пустая выдача фильтра — разные ситуации: в первой
          // сбрасывать нечего, во второй нужно назвать запрос и дать выход.
          <div className="col-span-2">
            {vehicles.length === 0 && noVehiclesText ? (
              <EmptyState icon={Truck} title={noVehiclesText} className="border-0 p-6" />
            ) : (
              <EmptyState
                icon={Truck}
                title={q ? `${ru.empty.notFound} по «${search.trim()}»` : emptyText}
                description={
                  filtered ? "Проверьте номер или снимите фильтр по виду техники." : undefined
                }
                action={
                  filtered ? (
                    <Button
                      variant="outline"
                      size="field"
                      onClick={() => {
                        setSearch("");
                        setType("all");
                      }}
                    >
                      {ru.empty.resetFilters}
                    </Button>
                  ) : undefined
                }
                className="border-0 p-6"
              />
            )}
          </div>
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
      className={`h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background active:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
