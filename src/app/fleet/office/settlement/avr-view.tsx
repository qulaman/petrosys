"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtLiters } from "@/lib/format";
import type { ContractorAvr } from "@/lib/data/avr";
import { exportContractorAvrXlsx } from "./actions";

const dash = (n: number, fmt: (x: number) => string = String) => (n > 0 ? fmt(n) : "—");

/** АВР по ИП: итог сверху, таблица по машинам (час/рейс/ГСМ Б/ГСМ К/итого). */
export function AvrView({ avr: a }: { avr: ContractorAvr }) {
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exportXlsx() {
    setError(null);
    start(async () => {
      const res = await exportContractorAvrXlsx(a.contractor.id, {
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
      const el = document.createElement("a");
      el.href = url;
      el.download = res.filename;
      el.click();
      URL.revokeObjectURL(url);
    });
  }

  const warnings = a.lines.filter((l) => l.noRateHours > 0 || l.noRateTrips > 0 || l.fuelPriceMissing);

  return (
    <div className="flex flex-col gap-5">
      {/* Итог по ИП — главная цифра сверху */}
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{a.contractor.name}</p>
            <p className="text-sm text-muted-foreground">
              {a.contracts.map((c) => c.number).join(", ") || "договоры не заведены"} ·{" "}
              {a.contractor.vat_payer ? "плательщик НДС" : "без НДС"} · {a.period.from}—{a.period.to}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-muted-foreground">Начислено по ИП</p>
            <p className={`text-2xl font-bold tabular-nums ${a.totals.accrual < 0 ? "text-destructive" : ""}`}>
              {fmtMoney(a.totals.accrual)}
            </p>
          </div>
          <Button variant="outline" onClick={exportXlsx} loading={pending}>
            <Download className="size-4" /> АВР в Excel
          </Button>
        </div>
      </section>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Таблица по машинам */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Номер</th>
              <th className="px-3 py-2 text-right">Час</th>
              <th className="px-3 py-2 text-right">Рейс</th>
              <th className="px-3 py-2 text-right">ГСМ Б, л</th>
              <th className="px-3 py-2 text-right">ГСМ К, л</th>
              <th className="px-3 py-2 text-right">Итого</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {a.lines.map((l) => (
              <tr key={l.reg}>
                <td className="px-3 py-2 font-medium">{l.reg}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dash(l.hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dash(l.trips)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dash(l.litersTanker, fmtLiters)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dash(l.litersCard, fmtLiters)}</td>
                <td className={`px-3 py-2 text-right font-medium tabular-nums ${l.total < 0 ? "text-destructive" : ""}`}>
                  {fmtMoney(l.total)}
                </td>
              </tr>
            ))}
            {a.lines.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Нет работ за период</td></tr>
            ) : null}
          </tbody>
          {a.lines.length ? (
            <tfoot className="bg-muted/50 font-semibold">
              <tr>
                <td className="px-3 py-2">Итого</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(a.totals.hoursAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums" colSpan={2}>{fmtMoney(a.totals.tripsAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">−{fmtMoney(a.totals.fuelHold)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(a.totals.accrual)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {warnings.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Не вошло в расчёт (нет тарифа или цены ГСМ):</p>
          {warnings.map((l) => (
            <p key={l.reg} className="text-muted-foreground">
              {l.reg}
              {l.noRateHours > 0 ? ` · часов без тарифа: ${l.noRateHours}` : ""}
              {l.noRateTrips > 0 ? ` · рейсов без тарифа: ${l.noRateTrips}` : ""}
              {l.fuelPriceMissing ? " · нет цены ГСМ" : ""}
            </p>
          ))}
        </div>
      ) : null}

      {a.penalties.length ? (
        <section className="flex flex-col gap-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">Штрафы (сверх АВР)</p>
          {a.penalties.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>{p.reason} · {p.date} · {p.contract}</span>
              <span className="tabular-nums">−{fmtMoney(p.amount)}</span>
            </div>
          ))}
          <div className="my-1 border-t" />
          <div className="flex justify-between font-semibold">
            <span>К оплате со штрафами</span>
            <span className="tabular-nums">{fmtMoney(a.totals.net)}</span>
          </div>
        </section>
      ) : null}

      {a.contractor.vat_payer ? (
        <p className="text-xs text-muted-foreground">
          в т.ч. НДС (16/116) из начисления: {fmtMoney(a.totals.vat)}
        </p>
      ) : null}
    </div>
  );
}
