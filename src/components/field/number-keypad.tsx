"use client";

import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Крупный числовой кейпад для ввода без клавиатуры (литры и т.п.).
 * Значение — строка (допускает незавершённый ввод «12.»). Пресеты частых значений.
 */
export function NumberKeypad({
  value,
  onChange,
  presets = [150, 200, 250, 300],
  allowDecimal = true,
}: {
  value: string;
  onChange: (next: string) => void;
  presets?: number[];
  allowDecimal?: boolean;
}) {
  function press(ch: string) {
    if (ch === "." ) {
      if (!allowDecimal || value.includes(".")) return;
      onChange(value === "" ? "0." : value + ".");
      return;
    }
    // не допускаем ведущих нулей вида 00
    const next = value === "0" ? ch : value + ch;
    // ограничим одну цифру после точки
    if (next.includes(".") && next.split(".")[1].length > 1) return;
    onChange(next);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", allowDecimal ? "." : "", "0", "⌫"];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button
            key={p}
            type="button"
            variant="secondary"
            className="h-12 flex-1 text-base font-semibold"
            onClick={() => onChange(String(p))}
          >
            {p}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {keys.map((k, i) =>
          k === "" ? (
            <div key={i} />
          ) : k === "⌫" ? (
            <Button
              key={i}
              type="button"
              variant="outline"
              className="h-16 text-xl"
              onClick={backspace}
              aria-label="Стереть"
            >
              <Delete className="size-6" />
            </Button>
          ) : (
            <Button
              key={i}
              type="button"
              variant="outline"
              className={cn("h-16 text-2xl font-semibold")}
              onClick={() => press(k)}
            >
              {k}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
