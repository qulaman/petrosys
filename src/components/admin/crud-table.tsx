"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ChevronsUpDown, Download, FileText, Inbox, Pencil, Plus, Search, SearchX, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { ru } from "@/lib/i18n/ru";
import { VEHICLE_TYPE_LABELS_PLURAL, type VehicleType } from "@/lib/domain";
import { ENTITIES, type ColumnDef, type FieldDef, type FieldType } from "@/lib/admin/registry";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtInt, fmtMoney } from "@/lib/format";
import { upsertRow, deleteRow } from "@/app/fleet/admin/actions";
import { generateDowntimeAct } from "@/app/fleet/office/documents/actions";

type Row = Record<string, unknown> & { id: string };
const NONE = "__none__";
const PAGE_SIZE = 25;

const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Минимум, нужный для отрисовки ячейки: колонка таблицы или поле формы (для CSV). */
type CellCol = {
  key: string;
  type?: FieldType;
  format?: ColumnDef["format"];
  labels?: Record<string, string>;
};

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
  const topRef = useRef<HTMLDivElement>(null);

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

  const inactiveCount = hasActive ? rows.filter((r) => !r.is_active).length : 0;

  function optionsFor(f: FieldDef) {
    if (f.options) return f.options;
    if (f.optionsFrom) return optionsByField[f.key] ?? [];
    return [];
  }

  /**
   * Текст ячейки: подписи значений, названия по FK, форматирование чисел.
   * В CSV числа уходят сырыми — разделители разрядов сломали бы разбор в Excel.
   */
  function cellText(row: Row, col: CellCol, forExport = false): string {
    const v = row[col.key];
    if (col.type === "boolean") return v ? "Да" : "—";
    if (v == null || v === "") return "—";
    if (col.format) {
      const n = Number(v);
      if (!Number.isNaN(n)) {
        if (forExport) return String(v);
        return col.format === "money" ? fmtMoney(n) : col.format === "int" ? fmtInt(n) : nf1.format(n);
      }
    }
    if (col.labels?.[String(v)]) return col.labels[String(v)];
    const field = cfg.fields.find((f) => f.key === col.key);
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
      list = list.filter((r) => cfg.columns.some((c) => cellText(r, c).toLowerCase().includes(query)));
    }
    if (sortKey) {
      const col = cfg.columns.find((c) => c.key === sortKey);
      // Числа и флаги сравниваем как числа: иначе «10» встаёт перед «9».
      const numeric = Boolean(col?.format) || col?.type === "boolean";
      list = [...list].sort((a, b) => {
        const cmp = numeric
          ? Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0)
          : cellText(a, col ?? { key: sortKey }).localeCompare(
              cellText(b, col ?? { key: sortKey }), "ru", { numeric: true },
            );
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeOnly, q, sortKey, sortDir, hasActive, isVehicles, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const pageRows = processed.slice(from, from + PAGE_SIZE);

  /**
   * Выгрузка CSV: колонки таблицы + поля формы, которых в таблице нет (БИН,
   * банк, нормы, даты допуска) — в файл попадает весь справочник, а не витрина.
   */
  const exportColumns: (CellCol & { label: string })[] = useMemo(() => {
    const inTable = new Set(cfg.columns.map((c) => c.key));
    return [
      ...cfg.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, format: c.format, labels: c.labels })),
      ...cfg.fields.filter((f) => !inTable.has(f.key)).map((f) => ({ key: f.key, label: f.label, type: f.type })),
    ];
  }, [cfg]);

  function exportCsv() {
    downloadCsv(
      `${cfg.title}.csv`,
      exportColumns.map((c) => c.label),
      processed.map((row) => exportColumns.map((c) => cellText(row, c, true))),
    );
  }

  /** Смена страницы с возвратом наверх — иначе список «начинается с середины». */
  function goToPage(p: number) {
    setPage(p);
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function resetFilters() {
    setQ("");
    setTypeFilter("all");
    setActiveOnly(false);
    setPage(0);
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
    if (miss.size) { setMissing(miss); toast.error(ru.errors.requiredFields); return; }
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
    <div ref={topRef} className="flex scroll-mt-28 flex-col gap-3">
      {/* Поиск, выгрузка, добавление */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Поиск…"
            className="h-9 w-full pl-8"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={processed.length === 0}
          onClick={exportCsv}
          title="Выгрузить то, что показано (с учётом поиска и фильтров)"
        >
          <Download className="size-4" /> CSV
        </Button>
        <Button size="sm" onClick={openNew}><Plus className="size-4" /> Добавить</Button>
      </div>

      {/* Фильтры слева, сводка справа — единый приём с журналами */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {hasActive ? (
          <div className="flex gap-1.5">
            <FilterChip label="Активные" active={activeOnly} onClick={() => { setActiveOnly(true); setPage(0); }} />
            <FilterChip label="Все" active={!activeOnly} onClick={() => { setActiveOnly(false); setPage(0); }} />
          </div>
        ) : null}

        {presentTypes.length > 1 ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
            <FilterChip label="Все виды" active={typeFilter === "all"} onClick={() => { setTypeFilter("all"); setPage(0); }} />
            {presentTypes.map((t) => (
              <FilterChip
                key={t}
                label={VEHICLE_TYPE_LABELS_PLURAL[t]}
                active={typeFilter === t}
                onClick={() => { setTypeFilter(t); setPage(0); }}
              />
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md border px-2.5 py-1">
            Найдено <b className="tabular-nums">{fmtInt(processed.length)}</b>
          </span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
            всего <b className="tabular-nums">{fmtInt(rows.length)}</b>
          </span>
          {inactiveCount > 0 ? (
            <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
              скрыто <b className="tabular-nums">{fmtInt(inactiveCount)}</b>
            </span>
          ) : null}
        </div>
      </div>

      {processed.length === 0 ? (
        // Пустой справочник и пустая выдача фильтра — разные ситуации с разным выходом.
        rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={`В справочнике «${cfg.title}» пока пусто`}
            description="Записи появятся здесь после добавления. Часть справочников пополняется и автоматически — из фактов работы."
            action={<Button size="sm" onClick={openNew}><Plus className="size-4" /> Добавить первую запись</Button>}
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="Ничего не найдено"
            description="Под текущий поиск и фильтры не подходит ни одна запись."
            action={<Button size="sm" variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>}
          />
        )
      ) : (
        <Table stickyHeader>
          <THead sticky>
            <tr>
              {cfg.columns.map((c) => (
                <Th key={c.key} align={c.format ? "right" : "left"}>
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sortKey === c.key
                      ? (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                      : <ChevronsUpDown className="size-3 opacity-40" />}
                  </button>
                </Th>
              ))}
              <Th align="right"><span className="sr-only">Действия</span></Th>
            </tr>
          </THead>
          <TBody>
            {pageRows.map((row) => (
              <Tr key={row.id}>
                {cfg.columns.map((c) => (
                  <Td key={c.key} align={c.format ? "right" : "left"} numeric={Boolean(c.format)}>
                    {c.type === "boolean" ? (
                      // Активность — статус, его читают цветом, а не словом «Да».
                      <StatusBadge tone={row[c.key] ? "success" : "muted"}>
                        {row[c.key] ? "Да" : "Нет"}
                      </StatusBadge>
                    ) : (
                      cellText(row, c)
                    )}
                  </Td>
                ))}
                <Td align="right">
                  <div className="flex justify-end gap-1">
                    {slug === "downtime_records" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Сформировать акт простоя"
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
                    <Button variant="ghost" size="sm" aria-label="Изменить" title="Изменить" onClick={() => openEdit(row)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Удалить"
                      title="Удалить"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setToDelete(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)}>
            Назад
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {fmtInt(from + 1)}–{fmtInt(Math.min(from + PAGE_SIZE, processed.length))} из {fmtInt(processed.length)}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => goToPage(page + 1)}>
            Вперёд
          </Button>
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
                  <label className="flex min-h-11 items-center gap-2 text-sm">
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
                    {/* Красной рамки мало: причина должна быть написана словами. */}
                    {missing.has(f.key) ? <p className="text-xs text-destructive">Обязательное поле</p> : null}
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // h-9 вместо h-8 — минимальный комфортный тач-таргет.
      className={`h-9 shrink-0 rounded-full border px-3.5 text-sm transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
