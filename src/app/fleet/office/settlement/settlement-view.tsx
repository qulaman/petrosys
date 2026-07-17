"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtLiters } from "@/lib/format";
import type { Settlement } from "@/lib/data/settlement";
import { exportSettlementXlsx } from "./actions";
import { generateClosingPackage, generateReconciliationAct } from "../documents/actions";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function SettlementView({ settlement: s }: { settlement: Settlement }) {
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function spParams() {
    return {
      period: sp.get("period") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    };
  }

  function saveDoc() {
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await generateReconciliationAct(s.contract.id, spParams());
      if (!res.ok) { setError(res.error); toast.error(res.error); }
      else { setSaved(res.number); toast.success(`Акт сохранён: ${res.number}`); }
    });
  }

  function savePackage() {
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await generateClosingPackage(s.contract.id, spParams());
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      setSaved(res.numbers.join(", "));
      toast.success(`Пакет закрытия сформирован: ${res.numbers.length} документа`);
    });
  }

  function exportXlsx() {
    setError(null);
    start(async () => {
      const res = await exportSettlementXlsx(s.contract.id, {
        period: sp.get("period") ?? undefined,
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
      });
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{s.contractor.name}</p>
          <p className="text-sm text-muted-foreground">
            Договор {s.contract.number} · {s.contractor.vat_payer ? "плательщик НДС" : "без НДС"} · {s.period.from}—{s.period.to}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportXlsx} disabled={pending}>
            <Download className="size-4" /> Акт в Excel
          </Button>
          <Button variant="outline" onClick={saveDoc} disabled={pending}>
            Акт в Документы
          </Button>
          <Button onClick={savePackage} disabled={pending}>
            {pending ? "Формирую…" : "Пакет закрытия (АВР + акт + реестры)"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {saved ? <p className="text-sm text-green-600">Сохранено в Документы: {saved}</p> : null}

      {/* Начислено */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Начислено</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="px-3 py-2">Машина</th><th className="px-3 py-2">Ед.</th><th className="px-3 py-2 text-right">Кол-во</th><th className="px-3 py-2 text-right">Ставка</th><th className="px-3 py-2 text-right">Сумма</th></tr>
            </thead>
            <tbody className="divide-y">
              {s.accrual.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-medium">{l.reg}</td>
                  <td className="px-3 py-2">{l.unit === "trip" ? "рейс" : "час"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                </tr>
              ))}
              {s.accrual.length === 0 ? <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Нет начислений за период</td></tr> : null}
            </tbody>
          </table>
        </div>
        {s.noRate.length ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Нет тарифа (в итог не включено):</p>
            {s.noRate.map((l, i) => (
              <p key={i} className="text-muted-foreground">{l.reg} · {l.unit === "trip" ? "рейсов" : "часов"}: {l.qty}</p>
            ))}
          </div>
        ) : null}
      </section>

      {/* Удержания */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Удержано за ГСМ</h3>
        <div className="rounded-lg border p-3 text-sm">
          {s.fuel.map((l, i) => (
            <div key={i} className="flex justify-between">
              <span>{l.reg} · {fmtLiters(l.liters)}{l.priceMissing ? " (нет цены)" : ""}</span>
              <span className="tabular-nums">{fmtMoney(l.amount)}</span>
            </div>
          ))}
          {s.fuel.length === 0 ? <p className="text-muted-foreground">Выдач за период нет</p> : null}
        </div>
      </section>

      {s.penalties.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Штрафы</h3>
          <div className="rounded-lg border p-3 text-sm">
            {s.penalties.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>{p.reason} · {p.date}</span>
                <span className="tabular-nums">{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Итог */}
      <section className="flex flex-col gap-1 rounded-lg border p-4">
        <Row label="Начислено" value={fmtMoney(s.totals.accrual)} />
        {s.contractor.vat_payer ? <Row label="в т.ч. НДС (16/116)" value={fmtMoney(s.totals.vat)} /> : null}
        <Row label="− Удержано ГСМ" value={fmtMoney(s.totals.fuelHold)} />
        <Row label="− Штрафы" value={fmtMoney(s.totals.penalty)} />
        <div className="my-1 border-t" />
        <Row label="К оплате" value={fmtMoney(s.totals.net)} strong />
      </section>
    </div>
  );
}
