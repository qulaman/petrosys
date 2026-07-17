"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronsUpDown, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { VEHICLE_TYPE_LABELS_PLURAL, type VehicleType } from "@/lib/domain";
import { ENTITIES, type FieldDef } from "@/lib/admin/registry";
import { upsertRow, deleteRow } from "@/app/fleet/admin/actions";
import { generateDowntimeAct } from "@/app/fleet/office/documents/actions";

type Row = Record<string, unknown> & { id: string };
const NONE = "__none__";
const PAGE_SIZE = 25;

export function CrudTable({
  slug,
  rows,
  optionsByField,
}: {
  slug: string;
  rows: Row[];
  optionsByField: Record<string, SearchSelectOption[]>;
}) {
  const cfg = ENTITIES[slug];
  const router = useRouter();
  const hasActive = cfg.fields.some((f) => f.key === "is_active");

  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [pending, start] = useTransition();

  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(hasActive);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Фильтр-чипы по виду техники — только в справочнике «Техника».
  const isVehicles = slug === "vehicles";
  const presentTypes = isVehicles
    ? (Object.keys(VEHICLE_TYPE_LABELS_PLURAL) as VehicleType[]).filter((t) =>
        rows.some((r) => r.vehicle_type === t),
      )
    : [];

  function optionsFor(f: FieldDef) {
    if (f.options) return f.options;
    if (f.optionsFrom) return optionsByField[f.key] ?? [];
    return [];
  }

  function cellText(row: Row, key: string, type?: string): string {
    const v = row[key];
    if (type === "boolean") return v ? "Да" : "—";
    if (v == null || v === "") return "—";
    const field = cfg.fields.find((f) => f.key === key);
    if (field) {
      const opt = optionsFor(field).find((o) => o.value === String(v));
      if (opt) return opt.label;
    }
    return String(v);
  }

  // фильтрация + сортировка + пагинация
  const processed = useMemo(() => {
    let list = rows;
    if (activeOnly && hasActive) list = list.filter((r) => r.is_active);
    if (isVehicles && typeFilter !== "all") list = list.filter((r) => r.vehicle_type === typeFilter);
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter((r) =>
        cfg.columns.some((c) => cellText(r, c.key, c.type).toLowerCase().includes(query)),
      );
    }
    if (sortKey) {
      const col = cfg.columns.find((c) => c.key === sortKey);
      list = [...list].sort((a, b) => {
        const av = col?.type === "boolean" ? (a[sortKey] ? 1 : 0) : cellText(a, sortKey, col?.type);
        const bv = col?.type === "boolean" ? (b[sortKey] ? 1 : 0) : cellText(b, sortKey, col?.type);
        const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv), "ru", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeOnly, q, sortKey, sortDir, hasActive, isVehicles, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const pageRows = processed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function openNew() {
    const initial: Record<string, unknown> = {};
    for (const f of cfg.fields) initial[f.key] = f.type === "boolean" ? f.key === "is_active" : "";
    setValues(initial); setMissing(new Set()); setEditing("new");
  }
  function openEdit(row: Row) {
    const initial: Record<string, unknown> = {};
    for (const f of cfg.fields) initial[f.key] = row[f.key] ?? (f.type === "boolean" ? false : "");
    setValues(initial); setMissing(new Set()); setEditing(row);
  }

  function save() {
    const miss = new Set<string>();
    for (const f of cfg.fields) {
      if (f.required && (values[f.key] === "" || values[f.key] == null)) miss.add(f.key);
    }
    if (miss.size) { setMissing(miss); toast.error("Заполните обязательные поля"); return; }
    const id = editing === "new" ? null : editing?.id ?? null;
    start(async () => {
      const res = await upsertRow(slug, id, values);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Сохранено");
      setEditing(null); router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const row = toDelete;
    start(async () => {
      const res = await deleteRow(slug, row.id);
      if (!res.ok) {
        // Запись используется в учёте — предлагаем деактивацию вместо удаления.
        if (res.fkBlocked && hasActive) { setDeleteBlocked(true); return; }
        setToDelete(null);
        toast.error(res.error);
        return;
      }
      setToDelete(null);
      toast.success("Удалено");
      router.refresh();
    });
  }

  function deactivateInstead() {
    if (!toDelete) return;
    const row = toDelete;
    const vals: Record<string, unknown> = {};
    for (const f of cfg.fields) vals[f.key] = row[f.key] ?? (f.type === "boolean" ? false : "");
    vals.is_active = false;
    start(async () => {
      const res = await upsertRow(slug, row.id, vals);
      setToDelete(null);
      setDeleteBlocked(false);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Запись деактивирована — скрыта из работы, история сохранена");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Панель: поиск, фильтр, добавить */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Поиск…" className="h-9 w-56 pl-8" />
        </div>
        {hasActive ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(0); }} className="size-4" />
            Только активные
          </label>
        ) : null}
        <p className="text-sm text-muted-foreground">Найдено: {processed.length}</p>
        <Button size="sm" className="ml-auto" onClick={openNew}><Plus className="size-4" /> Добавить</Button>
      </div>

      {presentTypes.length > 1 ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
          <TypeFilterChip label="Все" active={typeFilter === "all"} onClick={() => { setTypeFilter("all"); setPage(0); }} />
          {presentTypes.map((t) => (
            <TypeFilterChip
              key={t}
              label={VEHICLE_TYPE_LABELS_PLURAL[t]}
              active={typeFilter === t}
              onClick={() => { setTypeFilter(t); setPage(0); }}
            />
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {cfg.columns.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium">
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {pageRows.map((row) => (
              <tr key={row.id}>
                {cfg.columns.map((c) => (
                  <td key={c.key} className="px-3 py-2">{cellText(row, c.key, c.type)}</td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {slug === "downtime_records" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Сформировать акт простоя"
                        onClick={() =>
                          start(async () => {
                            const res = await generateDowntimeAct(row.id);
                            if (res.ok) toast.success(`Акт простоя: ${res.number} (см. «Документы»)`);
                            else toast.error(res.error);
                          })
                        }
                      >
                        <FileText className="size-4" />
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setToDelete(row)}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr><td colSpan={cfg.columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">Ничего не найдено</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Назад</Button>
          <span className="text-muted-foreground">{page + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
        </div>
      ) : null}

      {/* Диалог формы */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing === "new" ? `Новый: ${cfg.singular}` : `Изменить: ${cfg.singular}`}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {cfg.fields.map((f) => (
              <div key={f.key} className={f.type === "boolean" ? "flex items-center gap-2 sm:col-span-2" : "flex flex-col gap-1.5"}>
                {f.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.checked }))} className="size-5" />
                    {f.label}
                  </label>
                ) : (
                  <>
                    <Label htmlFor={f.key} className={missing.has(f.key) ? "text-destructive" : ""}>
                      {f.label}{f.required ? " *" : ""}
                    </Label>
                    {f.type === "select" && optionsFor(f).length > 12 ? (
                      // Длинный справочник (техника, договоры…) — выбор с поиском.
                      <SearchSelect
                        value={String(values[f.key] || "")}
                        onChange={(val) => setValues((s) => ({ ...s, [f.key]: val }))}
                        options={optionsFor(f)}
                        allowEmpty={!f.required}
                        triggerClassName={missing.has(f.key) ? "border-destructive" : ""}
                      />
                    ) : f.type === "select" ? (
                      <Select value={String(values[f.key] || NONE)} onValueChange={(val) => setValues((s) => ({ ...s, [f.key]: val === NONE ? "" : val }))}>
                        <SelectTrigger className={missing.has(f.key) ? "border-destructive" : ""}><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {!f.required ? <SelectItem value={NONE}>—</SelectItem> : null}
                          {optionsFor(f).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : f.type === "date" ? (
                      <Input id={f.key} type="date" value={String(values[f.key] ?? "")} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} className={missing.has(f.key) ? "border-destructive" : ""} />
                    ) : (
                      <Input id={f.key} inputMode={f.type === "number" ? "decimal" : undefined} value={String(values[f.key] ?? "")} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} className={missing.has(f.key) ? "border-destructive" : ""} />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={save} loading={pending}>{pending ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <Dialog open={toDelete !== null} onOpenChange={(o) => { if (!o) { setToDelete(null); setDeleteBlocked(false); } }}>
        <DialogContent className="sm:max-w-sm">
          {deleteBlocked ? (
            <>
              <DialogHeader><DialogTitle>Удалить нельзя</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                По этой записи уже есть данные учёта (выдачи, рейсы, смены или договоры) — удаление разрушило бы историю.
                Вместо этого запись можно <b>деактивировать</b>: она исчезнет из рабочих экранов, но история и отчёты сохранятся.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setToDelete(null); setDeleteBlocked(false); }}>Отмена</Button>
                <Button onClick={deactivateInstead} loading={pending}>{pending ? "Сохранение…" : "Деактивировать"}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>Удалить запись?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Действие необратимо.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setToDelete(null)}>Отмена</Button>
                <Button variant="destructive" onClick={confirmDelete} loading={pending}>Удалить</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TypeFilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 rounded-full border px-3 text-sm ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
