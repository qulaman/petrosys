"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney } from "@/lib/format";
import { VEHICLE_TYPE_LABELS, vehicleTypeLabel, type VehicleType } from "@/lib/domain";
import type { ContractDetail } from "@/lib/data/contracts-admin";
import { addFuelPrice, addPriceRow, deleteFuelPrice, deletePriceRow, regenerateContractDoc, upsertContract } from "../actions";
import { generateAmendment, generateAppendix2 } from "@/app/fleet/office/documents/actions";

export function ContractDetailView({
  data,
  templates = [],
}: {
  data: ContractDetail;
  templates?: { id: string; name: string; contract_type: string | null }[];
}) {
  const router = useRouter();
  const c = data.contract;
  const isEquipment = c.contract_type === "equipment";
  const [pending, start] = useTransition();

  // --- договор ---
  const [form, setForm] = useState({
    contractor_id: c.contractor_id,
    number: c.number,
    contract_type: c.contract_type as "transportation" | "equipment",
    billing_period: c.billing_period as "monthly" | "15days",
    valid_from: c.valid_from,
    valid_to: c.valid_to ?? "",
    is_active: c.is_active,
  });
  function saveContract() {
    start(async () => {
      const res = await upsertContract(c.id, {
        contractor_id: form.contractor_id, number: form.number, contract_type: form.contract_type,
        billing_period: form.billing_period, valid_from: form.valid_from, valid_to: form.valid_to || null, is_active: form.is_active,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Договор сохранён");
      router.refresh();
    });
  }

  // --- добавление ставки ---
  const [pr, setPr] = useState({ vehicle_type: "dump_truck", unit: isEquipment ? "hour" : "trip", price: "", vehicle_id: "", valid_from: "", note: "" });
  function addPrice() {
    const price = parseFloat(pr.price);
    if (!(price > 0) || !pr.valid_from) { toast.error("Укажите цену и дату"); return; }
    start(async () => {
      const res = await addPriceRow(c.id, {
        vehicle_type: pr.vehicle_type, unit: pr.unit as "trip" | "hour", price,
        vehicle_id: pr.vehicle_id || null, valid_from: pr.valid_from, note: pr.note || null,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Ставка добавлена");
      setPr((s) => ({ ...s, price: "", note: "" }));
      router.refresh();
    });
  }

  // --- добавление цены ГСМ ---
  const [fp, setFp] = useState({ price_per_liter: "", valid_from: "", note: "" });
  function addFuel() {
    const price = parseFloat(fp.price_per_liter);
    if (!(price > 0) || !fp.valid_from) { toast.error("Укажите цену и дату"); return; }
    start(async () => {
      const res = await addFuelPrice(c.id, { price_per_liter: price, valid_from: fp.valid_from, note: fp.note || null });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Цена ГСМ добавлена");
      setFp({ price_per_liter: "", valid_from: "", note: "" });
      router.refresh();
    });
  }

  function delPrice(id: string) {
    start(async () => { const r = await deletePriceRow(id, c.id); if (r.ok) { toast.success("Удалено"); router.refresh(); } else toast.error(r.error); });
  }
  function delFuel(id: string) {
    start(async () => { const r = await deleteFuelPrice(id, c.id); if (r.ok) { toast.success("Удалено"); router.refresh(); } else toast.error(r.error); });
  }

  // --- документы договора ---
  const latestValidFrom = [...data.prices.map((p) => p.valid_from), ...data.fuelPrices.map((f) => f.valid_from)]
    .sort()
    .at(-1) ?? "";
  const [amendDate, setAmendDate] = useState(latestValidFrom);
  const [regenTemplateId, setRegenTemplateId] = useState("");
  const fittingTemplates = templates.filter(
    (t) => t.contract_type == null || t.contract_type === form.contract_type,
  );
  function regenContract() {
    start(async () => {
      const r = await regenerateContractDoc(c.id, regenTemplateId || null);
      if (r.ok) toast.success(`Договор сформирован: ${r.number} (см. «Документы»)`);
      else toast.error(r.error);
    });
  }
  function genAppendix2() {
    start(async () => {
      const r = await generateAppendix2(c.id);
      if (r.ok) toast.success(`Сформировано: ${r.number} (см. «Документы»)`);
      else toast.error(r.error);
    });
  }
  function genAmendment() {
    if (!amendDate) { toast.error("Укажите дату изменений"); return; }
    start(async () => {
      const r = await generateAmendment(c.id, amendDate);
      if (r.ok) toast.success(`Доп. соглашение: ${r.number} (см. «Документы»)`);
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Реквизиты договора */}
      <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Контрагент</Label>
          <select value={form.contractor_id} onChange={(e) => setForm((s) => ({ ...s, contractor_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
            {data.contractors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label>Номер</Label><Input value={form.number} onChange={(e) => setForm((s) => ({ ...s, number: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5">
          <Label>Тип</Label>
          <select value={form.contract_type} onChange={(e) => setForm((s) => ({ ...s, contract_type: e.target.value as typeof form.contract_type }))} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="transportation">Перевозка</option>
            <option value="equipment">Услуги техники</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Расчётный период</Label>
          <select value={form.billing_period} onChange={(e) => setForm((s) => ({ ...s, billing_period: e.target.value as typeof form.billing_period }))} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="monthly">Месяц</option>
            <option value="15days">15 дней</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label>Действует с</Label><Input type="date" value={form.valid_from} onChange={(e) => setForm((s) => ({ ...s, valid_from: e.target.value }))} /></div>
        <div className="flex flex-col gap-1.5"><Label>по</Label><Input type="date" value={form.valid_to} onChange={(e) => setForm((s) => ({ ...s, valid_to: e.target.value }))} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((s) => ({ ...s, is_active: e.target.checked }))} className="size-4" /> Активен</label>
        <div className="sm:col-span-2"><Button onClick={saveContract} disabled={pending}>Сохранить договор</Button></div>
      </section>

      {/* Прайс-лист */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Ставки (прайс-лист) — доп. соглашение = новая строка с датой</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2">Вид техники</th><th className="px-3 py-2">Ед.</th><th className="px-3 py-2 text-right">Цена</th><th className="px-3 py-2">Машина (override)</th><th className="px-3 py-2">С даты</th><th className="px-3 py-2">Примечание</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y">
              {data.prices.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">{vehicleTypeLabel(p.vehicle_type)}</td>
                  <td className="px-3 py-2">{p.unit === "trip" ? "рейс" : "час"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.price)}</td>
                  <td className="px-3 py-2">{p.vehicle_id ? data.vehicles.find((v) => v.id === p.vehicle_id)?.reg_number ?? "—" : "весь вид"}</td>
                  <td className="px-3 py-2">{p.valid_from}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.note ?? ""}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => delPrice(p.id)}><Trash2 className="size-4 text-destructive" /></button></td>
                </tr>
              ))}
              {data.prices.length === 0 ? <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Ставок нет</td></tr> : null}
            </tbody>
          </table>
        </div>
        {/* добавить ставку */}
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-6">
          <select value={pr.vehicle_type} onChange={(e) => setPr((s) => ({ ...s, vehicle_type: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
            {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
          </select>
          <select value={pr.unit} onChange={(e) => setPr((s) => ({ ...s, unit: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
            {!isEquipment ? <option value="trip">рейс</option> : null}
            <option value="hour">час</option>
          </select>
          <Input inputMode="decimal" placeholder="Цена" value={pr.price} onChange={(e) => setPr((s) => ({ ...s, price: e.target.value.replace(/[^\d.]/g, "") }))} className="h-9" />
          <select value={pr.vehicle_id} onChange={(e) => setPr((s) => ({ ...s, vehicle_id: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">весь вид</option>
            {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_number}</option>)}
          </select>
          <Input type="date" value={pr.valid_from} onChange={(e) => setPr((s) => ({ ...s, valid_from: e.target.value }))} className="h-9" />
          <Button onClick={addPrice} disabled={pending} className="h-9">Добавить ставку</Button>
        </div>
      </section>

      {/* Цена ГСМ */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Цена ГСМ для удержания (effective-dated)</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2 text-right">₸/литр</th><th className="px-3 py-2">С даты</th><th className="px-3 py-2">Примечание</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y">
              {data.fuelPrices.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(f.price_per_liter)}</td>
                  <td className="px-3 py-2">{f.valid_from}</td>
                  <td className="px-3 py-2 text-muted-foreground">{f.note ?? ""}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => delFuel(f.id)}><Trash2 className="size-4 text-destructive" /></button></td>
                </tr>
              ))}
              {data.fuelPrices.length === 0 ? <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Цен нет — удержания ГСМ не будет</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
          <Input inputMode="decimal" placeholder="₸/литр" value={fp.price_per_liter} onChange={(e) => setFp((s) => ({ ...s, price_per_liter: e.target.value.replace(/[^\d.]/g, "") }))} className="h-9" />
          <Input type="date" value={fp.valid_from} onChange={(e) => setFp((s) => ({ ...s, valid_from: e.target.value }))} className="h-9" />
          <Input placeholder="Примечание" value={fp.note} onChange={(e) => setFp((s) => ({ ...s, note: e.target.value }))} className="h-9" />
          <Button onClick={addFuel} disabled={pending} className="h-9">Добавить цену ГСМ</Button>
        </div>
      </section>

      {/* Документы договора */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Документы договора</h3>
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Шаблон</Label>
              <select value={regenTemplateId} onChange={(e) => setRegenTemplateId(e.target.value)} className="h-9 w-44 rounded-md border bg-background px-2 text-sm">
                <option value="">Встроенная форма</option>
                {fittingTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <Button variant="outline" onClick={regenContract} disabled={pending}>
              Сформировать договор (docx)
            </Button>
          </div>
          <Button variant="outline" onClick={genAppendix2} disabled={pending}>
            Приложение №2 (новая редакция)
          </Button>
          <div className="ml-auto flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Изменения с даты</Label>
              <Input type="date" value={amendDate} onChange={(e) => setAmendDate(e.target.value)} className="h-9 w-40" />
            </div>
            <Button variant="outline" onClick={genAmendment} disabled={pending}>
              Сформировать доп. соглашение
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Приложение №2 собирается из привязанной к договору техники и водителей (номер редакции — автоматически).
          Допник — по ставкам/цене ГСМ, действующим с выбранной даты. Готовые файлы — в разделе «Документы».
        </p>
      </section>
    </div>
  );
}
