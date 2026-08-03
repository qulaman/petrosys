"use client";

import { useLayoutEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { FullscreenSheet, FullscreenSheetClose } from "@/components/field/fullscreen-sheet";
import { devLog } from "@/lib/dev-log";

/**
 * ВРЕМЕННАЯ ДИАГНОСТИКА. Подпись не рисуется на телефоне заказчика, а по коду
 * причину найти не вышло — панель отвечает на все вопросы разом, без кабеля и
 * консоли: доходят ли события до холста, что у них в `buttons` (signature_pad
 * отбрасывает касания, где бит левой кнопки не выставлен), не лежит ли что-то
 * сверху, совпадает ли битмап с боксом и появляются ли чернила на битмапе.
 * Убрать вместе с панелью в разметке, как только причина закрыта.
 */
interface Diag {
  /** pointerdown, пойманные на window в фазе перехвата — до любых обработчиков. */
  win: number;
  /** Из них дошедшие до самого холста. Расхождение = событие перехватывают. */
  canvas: number;
  move: number;
  up: number;
  cancel: number;
  /** touchstart: приходят ли touch-события, если pointer-события пусты. */
  touch: number;
  /** Куда реально прилетел pointerdown. */
  target: string;
  /** Что лежит сверху в точке касания (document.elementFromPoint). */
  top: string;
  /** pointerType / buttons / isPrimary последнего касания. */
  last: string;
  /** buttons на последнем движении: _handlePointerMove требует ровно 1. */
  moveBtn: string;
  /** Бокс холста, битмап и плотность. */
  box: string;
  strokes: number;
  /** Небелых пикселей на битмапе: отделяет «не видно» от «не нарисовано». */
  ink: number;
  ua: string;
  /** Исключение при настройке холста — иначе оно молчит и панель пуста. */
  err: string;
}

function newDiag(): Diag {
  const standalone =
    typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches;
  return {
    win: 0, canvas: 0, move: 0, up: 0, cancel: 0, touch: 0,
    target: "—", top: "—", last: "—", moveBtn: "—", box: "—",
    strokes: 0, ink: -1, err: "",
    ua:
      typeof navigator === "undefined"
        ? "—"
        : `${standalone ? "PWA · " : "вкладка · "}${navigator.userAgent.replace(/^Mozilla\/5\.0 \(?/, "").slice(0, 70)}`,
  };
}

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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);
  const diagRef = useRef<Diag>(newDiag());
  // Панель рисуется всегда, даже если настройка холста упала: пустая панель
  // сама по себе была бы ответом «код не доехал», и мы бы это не различили.
  const [diag, setDiag] = useState<Diag>(newDiag);
  const report = (err: string) => {
    diagRef.current.err = err;
    setDiag({ ...diagRef.current });
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) {
      report("холст не смонтирован");
      return;
    }

    let pad: SignaturePadLib;
    try {
      pad = new SignaturePadLib(canvas, {
        penColor: "#111",
        backgroundColor: "#fff",
      });
    } catch (e) {
      // Единственный реальный источник — null вместо 2d-контекста (телефон
      // отдал отказ по памяти). Молча это выглядит как «подпись не работает».
      report(`конструктор: ${String(e)}`);
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
     * (clientX - rect.left) и рисует их в битмап как есть. Если битмап остался
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
      diagRef.current.box = `бокс ${Math.round(width)}×${Math.round(height)} · битмап ${canvas.width}×${canvas.height} · dpr ${window.devicePixelRatio}→${ratio}`;
      devLog("signature-pad", diagRef.current.box);

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

    // ResizeObserver вместо одноразового замера и слушателей window: холст живёт
    // внутри портала base-ui (FullscreenSheet) и монтируется на пару коммитов
    // позже формы. Одиночный замер мог прийтись на момент, когда бокса ещё нет,
    // и молча отваливался по `if (!width || !height)` — битмап навсегда
    // оставался 300×150. Наблюдатель отдаёт размер сразу при observe() и на
    // каждое изменение: поворот, клавиатура, адресная строка — своих слушателей
    // на resize/orientationchange больше не нужно.
    // Если наблюдателя в движке нет (старый WebView) — откатываемся на прежнюю
    // схему: разовый замер плюс слушатели окна. Без этой ветки конструктор
    // ResizeObserver бросил бы исключение и подпись не открылась бы вовсе.
    const hasRO = typeof ResizeObserver !== "undefined";
    const ro = hasRO ? new ResizeObserver(fit) : null;
    if (ro) {
      ro.observe(canvas);
    } else {
      diagRef.current.err = "нет ResizeObserver";
      fit();
      window.addEventListener("resize", fit);
      window.addEventListener("orientationchange", fit);
    }

    // Страховка перед штрихом: если размер всё же разошёлся (случай, которого
    // наблюдатель не увидел), пересчитываем ДО того, как signature_pad начнёт
    // писать. Именно capture и именно на обёртке: свой слушатель библиотека
    // вешает на холст в конструкторе, то есть раньше нашего.
    box.addEventListener("pointerdown", fit, true);

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);

    // --- ВРЕМЕННАЯ ДИАГНОСТИКА: снять вместе с панелью в разметке ---
    const d = diagRef.current;
    const describe = (el: Element | null) => {
      if (!el) return "—";
      const cls = typeof el.className === "string" && el.className.trim()
        ? `.${el.className.trim().split(/\s+/)[0]}`
        : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    };
    /** Небелые пиксели битмапа — считаем каждый четвёртый, этого хватает. */
    const countInk = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) return -1;
      try {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let n = 0;
        for (let i = 0; i < data.length; i += 16) if (data[i] < 200) n++;
        return n;
      } catch {
        return -2;
      }
    };
    let drawing = false;
    // window в фазе перехвата — событие видно до любого обработчика и до того,
    // как его успеет съесть слой сверху.
    const onWinDown = (e: PointerEvent) => {
      drawing = true;
      d.win++;
      d.last = `${e.pointerType} buttons=${e.buttons} primary=${e.isPrimary}`;
      d.target = describe(e.target as Element);
      d.top = describe(document.elementFromPoint(e.clientX, e.clientY));
    };
    const onWinMove = (e: PointerEvent) => {
      if (!drawing) return;
      d.move++;
      d.moveBtn = `buttons=${e.buttons}`;
    };
    const onWinUp = () => {
      drawing = false;
      d.up++;
      d.strokes = pad.toData().length;
      d.ink = countInk();
    };
    const onWinCancel = () => {
      drawing = false;
      d.cancel++;
    };
    const onTouch = () => { d.touch++; };
    const onCanvasDown = () => { d.canvas++; };
    window.addEventListener("pointerdown", onWinDown, true);
    window.addEventListener("pointermove", onWinMove, true);
    window.addEventListener("pointerup", onWinUp, true);
    window.addEventListener("pointercancel", onWinCancel, true);
    window.addEventListener("touchstart", onTouch, true);
    canvas.addEventListener("pointerdown", onCanvasDown);
    const tick = setInterval(() => setDiag({ ...d }), 400);
    // --- конец диагностики ---

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      box.removeEventListener("pointerdown", fit, true);
      pad.removeEventListener("endStroke", onEnd);
      window.removeEventListener("pointerdown", onWinDown, true);
      window.removeEventListener("pointermove", onWinMove, true);
      window.removeEventListener("pointerup", onWinUp, true);
      window.removeEventListener("pointercancel", onWinCancel, true);
      window.removeEventListener("touchstart", onTouch, true);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      clearInterval(tick);
      pad.off();
    };
  }, []);

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
      {/* ВРЕМЕННАЯ ПАНЕЛЬ — убрать вместе с блоком диагностики в эффекте. */}
      <div className="mx-4 mb-2 rounded-lg border border-warning/40 bg-warning/10 p-2 font-mono text-xs leading-snug break-words">
        {diag.err ? <p className="font-bold text-destructive">СБОЙ: {diag.err}</p> : null}
        <p>{diag.box}</p>
        <p>
          down: окно {diag.win} / холст {diag.canvas} · move {diag.move} · up {diag.up} ·
          cancel {diag.cancel} · touch {diag.touch}
        </p>
        <p>событие: {diag.last} · move {diag.moveBtn}</p>
        <p>цель: {diag.target} · сверху: {diag.top}</p>
        <p>штрихов {diag.strokes} · чернил {diag.ink}</p>
        <p>{diag.ua}</p>
      </div>
      {/* Холст всегда белый с чёрным штрихом — независимо от темы: подпись
          уходит в документы и должна выглядеть одинаково. */}
      <div ref={boxRef} className="mx-4 flex-1 overflow-hidden rounded-lg border bg-white">
        <canvas
          ref={canvasRef}
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
