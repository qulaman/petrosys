"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { FileSignature, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/lib/domain";
import type { ContractListRow } from "@/lib/data/contracts-admin";
import { createContractWithTerms } from "./actions";

interface RateRow {
  vehicle_type: string;
  unit: "trip" | "hour";
  price: string;
}

const emptyForm = {
  contractor_id: "",
  number: "",
  contract_type: "transportation" as "transportation" | "equipment",
  billing_period: "monthly" as "monthly" | "15days",
  valid_from: "",
  valid_to: "",
  fuel_price: "",
};

/**
 * Мастер договора: реквизиты + ставки + цена ГСМ вводятся ОДИН раз —
 * создаются договор, прайс-лист, цена ГСМ и docx-пакет (договор, П1, П2).
 */
export function ContractsList({
  contracts,
  contractors,
  templates = [],
}: {
  contracts: ContractListRow[];
  contractors: { id: string; name: string }[];
  templates?: { id: string; name: string; contract_type: string | null }[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [rates, setRates] = useState<RateRow[]>([{ vehicle_type: "dump_truck", unit: "trip", price: "" }]);
  const [templateId, setTemplateId] = useState("");
  const [pending, start] = useTransition();

  const isEquipment = form.contract_type === "equipment";
  const fittingTemplates = templates.filter(
    (t) => t.contract_type == null || t.contract_type === form.contract_type,
  );

  function patchRate(i: number, patch: Partial<RateRow>) {
    setRates((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function create() {
    if (!form.contractor_id || !form.number || !form.valid_from) {
      toast.error("Заполните контрагента, номер и дату начала");
      return;
    }
    const parsedRates = rates
      .filter((r) => r.price !== "")
      .map((r) => ({
        vehicle_type: r.vehicle_type,
        unit: (isEquipment ? "hour" : r.unit) as "trip" | "hour",
        price: parseFloat(r.price),
      }));
    if (!parsedRates.length || parsedRates.some((r) => !(r.price > 0))) {
      toast.error("Добавьте хотя бы одну корректную ставку");
      return;
    }
    start(async () => {
      const res = await createContractWithTerms({
        contractor_id: form.contractor_id,
        number: form.number,
        contract_type: form.contract_type,
        billing_period: form.billing_period,
        valid_from: form.valid_from,
        valid_to: form.valid_to || null,
        rates: parsedRates,
        fuel_price: form.fuel_price ? parseFloat(form.fuel_price) : null,
        template_id: templateId || null,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(
        res.docs.length
          ? `Договор создан. Документы: ${res.docs.join(", ")}`
          : "Договор создан",
      );
      router.push(`/fleet/admin/contracts/${res.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" /> Мастер договора
        </Button>
      </div>

      {creating ? (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Условия вводятся один раз: создаются договор, прайс-лист, цена ГСМ и печатный пакет
            (договор + Приложение №1 + Приложение №2) — без двойного ввода.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Контрагент *</Label>
              <select value={form.contractor_id} onChange={(e) => setForm((s) => ({ ...s, contractor_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">—</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Номер договора *</Label>
              <Input value={form.number} onChange={(e) => setForm((s) => ({ ...s, number: e.target.value }))} placeholder="08/07-01-УОП-2026" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Тип</Label>
              <select
                value={form.contract_type}
                onChange={(e) => {
                  const v = e.target.value as typeof form.contract_type;
                  setForm((s) => ({ ...s, contract_type: v }));
                  if (v === "equipment") setRates((rs) => rs.map((r) => ({ ...r, unit: "hour" })));
                }}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="transportation">Перевозка (рейс/час)</option>
                <option value="equipment">Услуги техники (только час)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Расчётный период</Label>
              <select value={form.billing_period} onChange={(e) => setForm((s) => ({ ...s, billing_period: e.target.value as typeof form.billing_period }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="monthly">Месяц</option>
                <option value="15days">15 дней</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Действует с *</Label>
              <Input type="date" value={form.valid_from} onChange={(e) => setForm((s) => ({ ...s, valid_from: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>по (необязательно)</Label>
              <Input type="date" value={form.valid_to} onChange={(e) => setForm((s) => ({ ...s, valid_to: e.target.value }))} />
            </div>
          </div>

          {/* Ставки */}
          <div className="flex flex-col gap-2">
            <Label>Ставки (Приложение №1) *</Label>
            {rates.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_8rem_2.5rem] gap-2">
                <select value={r.vehicle_type} onChange={(e) => patchRate(i, { vehicle_type: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm">
                  {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => (
                    <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <select value={isEquipment ? "hour" : r.unit} disabled={isEquipment} onChange={(e) => patchRate(i, { unit: e.target.value as "trip" | "hour" })} className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-60">
                  {!isEquipment ? <option value="trip">рейс</option> : null}
                  <option value="hour">час</option>
                </select>
                <Input inputMode="decimal" placeholder="Цена, ₸" value={r.price} onChange={(e) => patchRate(i, { price: e.target.value.replace(/[^\d.]/g, "") })} className="h-9" />
                <Button variant="ghost" size="sm" className="h-9" disabled={rates.length === 1} onClick={() => setRates((rs) => rs.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setRates((rs) => [...rs, { vehicle_type: "dump_truck", unit: isEquipment ? "hour" : "trip", price: "" }])}>
              <Plus className="size-4" /> Ещё ставка
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Цена ГСМ для удержания, ₸/л (необязательно)</Label>
              <Input inputMode="decimal" value={form.fuel_price} onChange={(e) => setForm((s) => ({ ...s, fuel_price: e.target.value.replace(/[^\d.]/g, "") }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Шаблон договора (docx)</Label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">Встроенная форма</option>
                {fittingTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={create} loading={pending}>{pending ? "Создаю…" : "Создать договор + документы"}</Button>
            <Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr><th className="px-3 py-2">Номер</th><th className="px-3 py-2">Контрагент</th><th className="px-3 py-2">Тип</th><th className="px-3 py-2">Период</th><th className="px-3 py-2">Действует с</th><th className="px-3 py-2">Активен</th></tr>
          </thead>
          <tbody className="divide-y">
            {contracts.map((c) => (
              <tr key={c.id} className="hover:bg-accent">
                <td className="px-3 py-2 font-medium"><Link href={`/fleet/admin/contracts/${c.id}`} className="text-primary underline">{c.number}</Link></td>
                <td className="px-3 py-2">{c.contractor}</td>
                <td className="px-3 py-2">{c.contract_type === "transportation" ? "перевозка" : "услуги техники"}</td>
                <td className="px-3 py-2">{c.billing_period === "15days" ? "15 дней" : "месяц"}</td>
                <td className="px-3 py-2">{c.valid_from}</td>
                <td className="px-3 py-2">{c.is_active ? "да" : "—"}</td>
              </tr>
            ))}
            {contracts.length === 0 ? (
              <tr><td colSpan={6}>
                <EmptyState icon={FileSignature} title="Договоров нет" description="Создайте первый договор кнопкой выше — документы сформируются автоматически." className="border-0 p-6" />
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
