"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { FullscreenSheet, FullscreenSheetClose } from "@/components/field/fullscreen-sheet";
import { devLog, devError } from "@/lib/dev-log";

/**
 * Полноэкранная подпись пальцем. Сверху крупно ФИО подписанта, снизу — крупные
 * кнопки Очистить/Готово. onDone возвращает SVG-разметку подписи (вектор штрихов:
 * ~2 КБ против ~100 КБ у PNG с retina-канваса — критично для объёма хранилища).
 */
export function SignaturePad({
  signerName,
  subject,
  onDone,
  onCancel,
}: {
  signerName: string;
  /**
   * Предмет подписи — что именно человек подтверждает («225 л · 852 AOD»).
   * Подпись юридически значима, а телефон в этот момент в руках у водителя:
   * без этой строки он расписывался, не видя ни литров, ни машины.
   */
  subject?: string;
  onDone: (svg: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Счётчик появлений холста в DOM — по нему запускается настройка.
   * FullscreenSheet отдаёт содержимое через портал base-ui, а тот рендерит
   * детей только после того, как создаст узел портала, — на пару коммитов
   * позже. Эффект с пустыми зависимостями отрабатывал раньше, получал
   * `canvasRef.current === null`, молча выходил по проверке и больше не
   * повторялся: signature_pad не создавался вообще. Три дня это выглядело как
   * «окно открывается, но ничего не пишется» при вечно сером «Готово».
   */
  const [canvasMounted, setCanvasMounted] = useState(0);
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    if (el) setCanvasMounted((n) => n + 1);
  }, []);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.parentElement;

    let pad: SignaturePadLib;
    try {
      pad = new SignaturePadLib(canvas, {
        penColor: "#111",
        backgroundColor: "#fff",
      });
    } catch (e) {
      // Реальный источник один — null вместо 2d-контекста (телефон отказал по
      // памяти). Молча это неотличимо от «подпись не работает», а заправщик в
      // поле должен понимать, что делать.
      devError("signature-pad", e);
      // Правило запрещает setState в теле эффекта из-за каскадных рендеров.
      // Здесь это одноразовая аварийная ветка, и молчать в ней нельзя: именно
      // молчаливый отказ настройки холста стоил трёх дней разбирательств.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    padRef.current = pad;

    // Размер холста в CSS-пикселях на момент последней настройки битмапа. Нужен,
    // чтобы пересчитать координаты уже нарисованных штрихов при смене размера.
    let cssW = 0;
    let cssH = 0;

    /**
     * Привести битмап холста к его CSS-боксу. Без этого подпись не видна:
     * signature_pad кладёт точку в CSS-координатах относительно холста
     * (clientX - rect.left) и рисует её в битмап как есть. Если битмап остался
     * дефолтным 300×150, а бокс на телефоне ~360×430, всё ниже 150-го пикселя
     * уходит за пределы битмапа — палец водит, а на экране пусто.
     */
    const fit = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      // Наблюдатель шлёт события и когда бокс не менялся (перерисовка слоя) —
      // если размер тот же, трогать холст нельзя: canvas.width стирает подпись.
      if (width === cssW && height === cssH) return;

      // Поворот телефона раньше стирал подпись: canvas.width сбрасывает холст,
      // а старый код после этого ещё и звал pad.clear(). Сохраняем штрихи и
      // переносим их в новые пропорции.
      const strokes = pad.toData();
      const scaleX = cssW ? width / cssW : 1;
      const scaleY = cssH ? height / cssH : 1;

      // Плотность ограничена двойкой: при DPR 3–4 битмап уходит за 1400×1700,
      // рисование на телефоне начинает лагать, а подпись всё равно уезжает в
      // документы вектором — на её качество плотность не влияет.
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      cssW = width;
      cssH = height;
      devLog("signature-pad", `бокс ${Math.round(width)}×${Math.round(height)} · битмап ${canvas.width}×${canvas.height}`);

      if (strokes.length) {
        pad.fromData(
          strokes.map((g) => ({
            ...g,
            points: g.points.map((p) => ({ ...p, x: p.x * scaleX, y: p.y * scaleY })),
          })),
        );
      } else {
        pad.clear();
      }
      setEmpty(pad.isEmpty());
    };

    // ResizeObserver вместо одноразового замера и слушателей window: размер
    // приходит сразу при observe() и на каждое изменение бокса — поворот,
    // клавиатура, адресная строка. Если наблюдателя в движке нет (старый
    // WebView), откатываемся на прежнюю схему, иначе его конструктор бросил бы
    // исключение и окно подписи не открылось бы вовсе.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) {
      ro.observe(canvas);
    } else {
      fit();
      window.addEventListener("resize", fit);
      window.addEventListener("orientationchange", fit);
    }

    // Страховка перед штрихом: если размер всё же разошёлся (случай, которого
    // наблюдатель не увидел), пересчитываем ДО того, как signature_pad начнёт
    // писать. Именно capture и именно на обёртке: свой слушатель библиотека
    // вешает на холст в конструкторе, то есть раньше нашего.
    box?.addEventListener("pointerdown", fit, true);

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      box?.removeEventListener("pointerdown", fit, true);
      pad.removeEventListener("endStroke", onEnd);
      pad.off();
    };
  }, [canvasMounted]);

  function clear() {
    padRef.current?.clear();
    setEmpty(true);
  }

  function done() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    onDone(pad.toSVG({ includeBackgroundColor: true }));
  }

  return (
    <FullscreenSheet title={`${signerName}, распишитесь`} onClose={onCancel}>
      {subject ? (
        <p className="mx-4 mb-2 rounded-lg bg-muted px-3 py-2 text-center text-lg font-bold tabular-nums">
          {subject}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mx-4 mb-2 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
          Поле подписи не открылось. Закройте окно и попробуйте ещё раз.
        </p>
      ) : null}
      {/* Холст всегда белый с чёрным штрихом — независимо от темы: подпись
          уходит в документы и должна выглядеть одинаково. */}
      <div className="mx-4 flex-1 overflow-hidden rounded-lg border bg-white">
        <canvas
          ref={attachCanvas}
          aria-label="Поле для подписи пальцем"
          className="h-full w-full touch-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <Button variant="outline" className="h-14 text-base" onClick={clear} type="button">
          Очистить
        </Button>
        <Button className="h-14 text-base" onClick={done} disabled={empty} type="button">
          Готово
        </Button>
      </div>
      <FullscreenSheetClose
        render={
          <Button
            variant="ghost"
            className="mx-auto mb-4 min-h-11 text-sm font-normal text-muted-foreground underline"
          />
        }
      >
        Отмена
      </FullscreenSheetClose>
    </FullscreenSheet>
  );
}
