"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Заголовок группы (например, вид техники). Группы должны идти подряд. */
  group?: string;
}

/**
 * Выпадающий список с поиском — замена нативному <select> на сотни строк
 * (выбор машины, договора и т.п. в офисных/админ-формах).
 */
export function SearchSelect({
  value,
  onChange,
  options,
  allowEmpty = true,
  emptyLabel = "—",
  placeholder = "Поиск…",
  className,
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? null;
  const query = q.trim().toLowerCase();
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query))
    : options;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  let lastGroup: string | undefined;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQ(""); }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm",
          !selected && "text-muted-foreground",
          triggerClassName,
        )}
      >
        <span className="truncate">{selected ? selected.label : emptyLabel}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="mb-1 h-9"
          />
          <div className="max-h-60 overflow-y-auto">
            {allowEmpty ? (
              <OptionButton active={value === ""} label={emptyLabel} onClick={() => pick("")} muted />
            ) : null}
            {filtered.map((o) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {header ? (
                    <p className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">{header}</p>
                  ) : null}
                  <OptionButton active={o.value === value} label={o.label} onClick={() => pick(o.value)} />
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OptionButton({
  active,
  label,
  onClick,
  muted,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
        muted && "text-muted-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {active ? <Check className="size-4 shrink-0" /> : null}
    </button>
  );
}
