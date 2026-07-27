"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTH = 272; // w-68: ширина пузыря, нужна для расчёта позиции

/**
 * Подсказка, открывающаяся по тапу. Нативный `title=` на телефоне не
 * открывается вообще, а приложение — PWA для полевых сотрудников, поэтому
 * пояснения к колонкам через `title` для половины пользователей не существуют.
 *
 * Пузырь позиционируется `fixed` по координатам кнопки: внутри таблиц с
 * `overflow-x-auto` абсолютный блок обрезается контейнером. Из-за `fixed`
 * закрываемся на скролле — пузырь за кнопкой не поедет.
 */
export function InfoHint({ text, label = "Пояснение", className }: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)),
    });
  };

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={pos != null}
        aria-controls={pos ? id : undefined}
        className={cn("inline-flex shrink-0 align-middle text-muted-foreground transition-colors hover:text-foreground", className)}
      >
        <Info className="size-3.5" />
      </button>
      {pos ? (
        <span
          id={id}
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: WIDTH }}
          className="fixed z-50 rounded-lg border bg-popover p-2.5 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-md"
        >
          {text}
        </span>
      ) : null}
    </>
  );
}
