"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtMoney } from "@/lib/format";
import { vehicleTypeLabel } from "@/lib/domain";
import { DOC_LABELS, type DocType, type RegistryData, type RegistryVehicle } from "@/lib/avr-registry-shared";
import { addRateVersion, attachVehicle, setVehicleDrivers } from "./actions";

const selectCls =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const num = (s: string) => (s.trim() ? parseFloat(s.replace(/\s/g, "").replace(",", ".")) : null);
const dash = (v: number | null) => (v != null ? fmtMoney(v) : "—");
const dmy = (d: string) => d.split("-").reverse().join(".");

export function AvrRegistryClient({ data }: { data: RegistryData }) {
  const [q, setQ] = useState("");
  const [history, setHistory] = useState(false);
  const query = q.toLowerCase().trim();

  const groups = useMemo(
    () =>
      data.groups
        .map((g) => ({
          ...g,
          vehicles: g.vehicles.filter(
            (v) => !query || g.contractor.toLowerCase().includes(query) || v.reg_number.toLowerCase().includes(query),
          ),
        }))
        .filter((g) => g.vehicles.length),
    [data.groups, query],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: ИП или номер машины" className="pl-9" />
        </div>
        <Button size="sm" variant={history ? "default" : "outline"} onClick={() => setHistory(!history)}>
          {history ? "История: показана" : "Показать историю условий"}
        </Button>
      </div>

      <datalist id="avr-drivers">
        {data.drivers.map((d) => <option key={d.id} value={d.full_name} />)}
      </datalist>

      {data.unassigned.length ? <UnassignedBlock data={data} /> : null}

      {groups.map((g) => (
        <section key={g.contractor_id} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2">
            <span className="font-semibold">{g.contractor}</span>
            <span className="rounded bg-accent px-1.5 py-0.5 text-xs">{g.vat_payer ? "с НДС" : "без НДС"}</span>
            <span className="text-xs text-muted-foreground">машин: {g.vehicles.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Номер</th>
                  <th className="px-2 py-1.5 font-medium">Тип</th>
                  <th className="px-2 py-1.5 text-right font-medium">Час</th>
                  <th className="px-2 py-1.5 text-right font-medium">Рейс</th>
                  <th className="px-2 py-1.5 text-right font-medium">ГСМ</th>
                  <th className="px-2 py-1.5 font-medium">Водитель день</th>
                  <th className="px-2 py-1.5 font-medium">Водитель ночь</th>
                  <th className="px-2 py-1.5 font-medium">Действует с</th>
                  <th className="px-2 py-1.5 font-medium">Документ</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.vehicles.map((v) => (
                  <VehicleRows key={v.id} v={v} history={history} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">Ничего не найдено.</p> : null}
    </div>
  );
}

function VehicleRows({ v, history }: { v: RegistryVehicle; history: boolean }) {
  const [form, setForm] = useState<"rates" | "drivers" | null>(null);
  const versions = history ? v.versions : v.versions.filter((x) => x.current);
  const shown = versions.length ? versions : [null];

  return (
    <>
      {shown.map((ver, i) => (
        <tr key={ver?.valid_from ?? "none"} className={ver && !ver.current ? "text-muted-foreground" : ""}>
          {i === 0 ? (
            <>
              <td className="px-3 py-1.5 font-medium" rowSpan={shown.length}>{v.reg_number}</td>
              <td className="px-2 py-1.5" rowSpan={shown.length}>{vehicleTypeLabel(v.vehicle_type)}</td>
            </>
          ) : null}
          <td className="px-2 py-1.5 text-right tabular-nums">{ver ? dash(ver.hour) : "—"}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{ver ? dash(ver.trip) : "—"}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{ver ? dash(ver.fuel) : "—"}</td>
          {i === 0 ? (
            <>
              <td className="px-2 py-1.5" rowSpan={shown.length}>{v.day_driver ?? "—"}</td>
              <td className="px-2 py-1.5" rowSpan={shown.length}>{v.night_driver ?? "—"}</td>
            </>
          ) : null}
          <td className="px-2 py-1.5 tabular-nums">{ver ? dmy(ver.valid_from) : "—"}</td>
          <td className="px-2 py-1.5">
            {ver?.doc_type ? DOC_LABELS[ver.doc_type] : "—"}
            {ver?.current && v.versions.length > 1 ? <span className="ml-1 text-xs text-primary">актуально</span> : null}
          </td>
          {i === 0 ? (
            <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={shown.length}>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setForm(form === "rates" ? null : "rates")}>
                <Plus className="size-3.5" /> условия
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setForm(form === "drivers" ? null : "drivers")}>
                <UserRound className="size-3.5" /> водители
              </Button>
            </td>
          ) : null}
        </tr>
      ))}
      {form === "rates" ? (
        <tr><td colSpan={10} className="bg-muted/30 px-3 py-2"><RateForm vehicleId={v.id} onDone={() => setForm(null)} /></td></tr>
      ) : null}
      {form === "drivers" ? (
        <tr><td colSpan={10} className="bg-muted/30 px-3 py-2">
          <DriversForm vehicleId={v.id} day={v.day_driver} night={v.night_driver} onDone={() => setForm(null)} />
        </td></tr>
      ) : null}
    </>
  );
}

function DocSelect({ value, onChange }: { value: DocType; onChange: (v: DocType) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value as DocType)}>
      {Object.entries(DOC_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

function RateForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [trip, setTrip] = useState("");
  const [fuel, setFuel] = useState("");
  const [doc, setDoc] = useState<DocType>("addendum");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await addRateVersion({
        vehicle_id: vehicleId, valid_from: date,
        hour_price: num(hour), trip_price: num(trip), fuel_price: num(fuel), doc_type: doc,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Условия добавлены");
      onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Действует с
        <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Час, ₸
        <Input className="h-9 w-28" inputMode="decimal" value={hour} onChange={(e) => setHour(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Рейс, ₸
        <Input className="h-9 w-28" inputMode="decimal" value={trip} onChange={(e) => setTrip(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">ГСМ, ₸/л (на весь договор)
        <Input className="h-9 w-28" inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Документ
        <DocSelect value={doc} onChange={setDoc} /></label>
      <Button size="sm" onClick={submit} loading={pending}>Сохранить</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Отмена</Button>
    </div>
  );
}

function DriversForm({ vehicleId, day, night, onDone }: { vehicleId: string; day: string | null; night: string | null; onDone: () => void }) {
  const [dayName, setDayName] = useState(day ?? "");
  const [nightName, setNightName] = useState(night ?? "");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await setVehicleDrivers({
        vehicle_id: vehicleId, day_name: dayName || null, night_name: nightName || null,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Водители сохранены");
      onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Водитель день (ФИО)
        <Input className="h-9 w-52" list="avr-drivers" value={dayName} onChange={(e) => setDayName(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Водитель ночь (ФИО)
        <Input className="h-9 w-52" list="avr-drivers" value={nightName} onChange={(e) => setNightName(e.target.value)} /></label>
      <Button size="sm" onClick={submit} loading={pending}>Сохранить</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Отмена</Button>
      <p className="w-full text-xs text-muted-foreground">Нового водителя можно вписать — он появится в справочнике водителей.</p>
    </div>
  );
}

function UnassignedBlock({ data }: { data: RegistryData }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="mb-2 text-sm font-medium">
        Без ИП и условий ({data.unassigned.length}) — не попадают в расчёт АВР:
      </p>
      <div className="flex flex-col gap-1">
        {data.unassigned.map((v) => (
          <div key={v.id} className="rounded border bg-background px-3 py-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{v.reg_number}</span>
              <span className="text-muted-foreground">{vehicleTypeLabel(v.vehicle_type)} · {v.reason}</span>
              <Button variant="outline" size="sm" className="ml-auto h-7" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                <Pencil className="size-3.5" /> Заполнить
              </Button>
            </div>
            {openId === v.id ? <AttachForm data={data} vehicleId={v.id} onDone={() => setOpenId(null)} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function AttachForm({ data, vehicleId, onDone }: { data: RegistryData; vehicleId: string; onDone: () => void }) {
  const [contractorId, setContractorId] = useState("");
  const [newName, setNewName] = useState("");
  const [newBin, setNewBin] = useState("");
  const [newVat, setNewVat] = useState(true);
  const [contractId, setContractId] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [trip, setTrip] = useState("");
  const [fuel, setFuel] = useState("");
  const [doc, setDoc] = useState<DocType>("contract");
  const [dayName, setDayName] = useState("");
  const [nightName, setNightName] = useState("");
  const [pending, start] = useTransition();

  const contractsOf = data.contracts.filter((c) => c.contractor_id === contractorId);

  function submit() {
    start(async () => {
      const res = await attachVehicle({
        vehicle_id: vehicleId,
        contractor_id: contractorId || null,
        new_contractor_name: contractorId ? null : newName || null,
        new_contractor_bin: contractorId ? null : newBin || null,
        new_contractor_vat: newVat,
        contract_id: contractId || null,
        new_contract_number: contractId ? null : newNumber || null,
        valid_from: date,
        hour_price: num(hour), trip_price: num(trip), fuel_price: num(fuel),
        doc_type: doc,
        day_name: dayName || null, night_name: nightName || null,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Машина привязана и готова к расчёту АВР");
      onDone();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">ИП / ТОО
          <select className={selectCls} value={contractorId} onChange={(e) => { setContractorId(e.target.value); setContractId(""); }}>
            <option value="">— новый контрагент —</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        {!contractorId ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Название нового
              <Input className="h-9 w-48" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ИП «…»" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">ИИН/БИН
              <Input className="h-9 w-36" inputMode="numeric" value={newBin} onChange={(e) => setNewBin(e.target.value.replace(/\D/g, ""))} /></label>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newVat} onChange={(e) => setNewVat(e.target.checked)} /> плательщик НДС
            </label>
          </>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Договор
          <select className={selectCls} value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">— новый договор —</option>
            {contractsOf.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
          </select></label>
        {!contractId ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Номер нового договора
            <Input className="h-9 w-48" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="№…-2026 от …" /></label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Действует с
          <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Час, ₸
          <Input className="h-9 w-28" inputMode="decimal" value={hour} onChange={(e) => setHour(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Рейс, ₸
          <Input className="h-9 w-28" inputMode="decimal" value={trip} onChange={(e) => setTrip(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">ГСМ, ₸/л
          <Input className="h-9 w-28" inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Документ
          <DocSelect value={doc} onChange={setDoc} /></label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Водитель день
          <Input className="h-9 w-48" list="avr-drivers" value={dayName} onChange={(e) => setDayName(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Водитель ночь
          <Input className="h-9 w-48" list="avr-drivers" value={nightName} onChange={(e) => setNightName(e.target.value)} /></label>
        <Button size="sm" onClick={submit} loading={pending}>Привязать</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Отмена</Button>
      </div>
    </div>
  );
}
