"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCircle2, ChevronDown, ExternalLink, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { SearchSelect } from "@/components/ui/search-select";
import { fmtDateTime } from "@/lib/format";
import { SEVERITY_LABELS, STATUS_LABELS } from "@/lib/anomalies";
import { cn } from "@/lib/utils";
import {
  bulkUpdateStatus,
  createPenaltyFromAnomaly,
  markReviewed,
  recomputeAction,
  updateAnomalyStatus,
} from "./actions";
import { generateClaim } from "@/app/fleet/office/documents/actions";

export interface AnomalyRow {
  id: string;
  type: string;
  typeLabel: string;
  severity: string;
  status: "new" | "reviewed" | "confirmed" | "dismissed";
  detected_at: string;
  /** Дата события (yyyy-mm-dd) — главная дата карточки. */
  eventDate: string;
  reg: string | null;
  driver: string | null;
  vehicle_id: string | null;
  summary: string;
  explanation: string;
  links: { label: string; href: string }[];
  note: string | null;
  reviewedBy: string | null;
  canPenalty: boolean;
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Открытые" },
  { key: "new", label: "Новые" },
  { key: "confirmed", label: "Подтверждённые" },
  { key: "dismissed", label: "Снятые" },
  { key: "all", label: "Все" },
];

const DATE_FILTERS: { key: string; label: string; days: number | null }[] = [
  { key: "all", label: "За всё время", days: null },
  { key: "7", label: "7 дней", days: 7 },
  { key: "30", label: "30 дней", days: 30 },
];

const statusTone: Record<string, StatusTone> = {
  new: "amber",
  reviewed: "blue",
  confirmed: "red",
  dismissed: "muted",
};

const PAGE_SIZE = 50;

const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function AnomaliesClient({ rows }: { rows: AnomalyRow[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState("");
  // Граница периода считается в обработчике клика (Date.now в рендере запрещён).
  const [dateFilter, setDateFilter] = useState<{ key: string; minDate: string | null }>({ key: "all", minDate: null });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Локально просмотренные (new → reviewed без перезагрузки). */
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [penaltyFor, setPenaltyFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const effStatus = (r: AnomalyRow) => (seen.has(r.id) && r.status === "new" ? "reviewed" : r.status);

  // Фильтры применяются последовательно; чипы типов считаются ПОСЛЕ статуса/машины/периода.
  const preType = useMemo(() => {
    const minDate = dateFilter.minDate;
    return rows.filter((r) => {
      const s = effStatus(r);
      if (statusFilter === "open" ? !(s === "new" || s === "reviewed") : statusFilter !== "all" && s !== statusFilter) return false;
      if (vehicleFilter && r.vehicle_id !== vehicleFilter) return false;
      if (minDate && r.eventDate < minDate) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, statusFilter, vehicleFilter, dateFilter, seen]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const r of preType) {
      const cur = m.get(r.type) ?? { label: r.typeLabel, count: 0 };
      cur.count += 1;
      m.set(r.type, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [preType]);

  const visible = typeFilter ? preType.filter((r) => r.type === typeFilter) : preType;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const vehicleOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.vehicle_id && r.reg) m.set(r.vehicle_id, r.reg);
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [rows]);

  function resetPage() {
    setPage(0);
    setSelected(new Set());
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string; count?: number }>, successMsg?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Ошибка");
      else {
        if (successMsg) toast.success(successMsg.replace("{n}", String(res.count ?? "")));
        else if (typeof res.count === "number") toast.success(`Пересчёт: +${res.count} новых аномалий`);
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function toggleExpand(r: AnomalyRow) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
    // Раскрытие «нового» — считаем просмотренным (тихо, без перезагрузки списка).
    if (r.status === "new" && !seen.has(r.id)) {
      setSeen((prev) => new Set(prev).add(r.id));
      void markReviewed(r.id);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) for (const r of pageRows) next.delete(r.id);
      else for (const r of pageRows) next.add(r.id);
      return next;
    });
  }

  function bulk(status: "confirmed" | "dismissed") {
    const ids = [...selected];
    if (!ids.length) return;
    const note =
      status === "dismissed" ? (window.prompt(`Снять ${ids.length} шт. Комментарий (необязательно):`) ?? "") : "";
    act(
      () => bulkUpdateStatus(ids, status, note || null),
      status === "confirmed" ? "Подтверждено: {n}" : "Снято: {n}",
    );
  }

  function dismiss(id: string) {
    const note = window.prompt("Комментарий к снятию (необязательно):") ?? "";
    act(() => updateAnomalyStatus(id, "dismissed", note || null));
  }

  function submitPenalty(id: string) {
    const amt = parseFloat(amount);
    if (!(amt > 0)) {
      toast.error("Введите сумму штрафа");
      return;
    }
    act(async () => {
      const res = await createPenaltyFromAnomaly(id, amt, reason || "Превышение норматива расхода ГСМ");
      if (res.ok) {
        setPenaltyFor(null);
        setAmount("");
        setReason("");
      }
      return res;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Сводка по типам — и фильтр, и картина «чего сколько» */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => { setTypeFilter(null); resetPage(); }}
          className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", typeFilter == null ? "bg-accent" : "hover:bg-accent")}
        >
          Все типы · {preType.length}
        </button>
        {typeCounts.map(([type, { label, count }]) => (
          <button
            key={type}
            type="button"
            onClick={() => { setTypeFilter(typeFilter === type ? null : type); resetPage(); }}
            className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", typeFilter === type ? "bg-accent" : "hover:bg-accent")}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={statusFilter === f.key ? "default" : "outline"} onClick={() => { setStatusFilter(f.key); resetPage(); }}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {DATE_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={dateFilter.key === f.key ? "secondary" : "ghost"}
              onClick={() => {
                setDateFilter({
                  key: f.key,
                  minDate: f.days ? new Date(Date.now() - f.days * 864e5).toISOString().slice(0, 10) : null,
                });
                resetPage();
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {vehicleOptions.length > 0 ? (
          <SearchSelect
            value={vehicleFilter}
            onChange={(v) => { setVehicleFilter(v); resetPage(); }}
            options={vehicleOptions}
            emptyLabel="Все машины"
            triggerClassName="h-8 w-40"
          />
        ) : null}
        <Button size="sm" variant="secondary" className="ml-auto" loading={pending} onClick={() => act(recomputeAction)}>
          <RefreshCw className="size-4" /> Пересчитать сейчас
        </Button>
      </div>

      {/* Панель массовых действий */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectPage} className="size-4 accent-primary" />
          Выбрать страницу
        </label>
        {selected.size > 0 ? (
          <>
            <span className="text-muted-foreground">выбрано: {selected.size}</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("confirmed")}>
              <Check className="size-4" /> Подтвердить
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("dismissed")}>
              <X className="size-4" /> Снять
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Отметьте карточки, чтобы разобрать пачкой</span>
        )}
      </div>

      <div className="flex flex-col divide-y rounded-lg border">
        {pageRows.map((a) => {
          const isOpen = expanded.has(a.id);
          const st = effStatus(a);
          return (
            <div key={a.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggleSelect(a.id)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                  aria-label="Выбрать"
                />
                <button type="button" onClick={() => toggleExpand(a)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold tabular-nums">{ddmmyyyy(a.eventDate)}</span>
                    <span className="font-medium">{a.typeLabel}</span>
                    {a.reg ? <span className="text-sm text-muted-foreground">{a.reg}</span> : null}
                    {a.driver && !a.reg ? <span className="text-sm text-muted-foreground">{a.driver}</span> : null}
                    <StatusBadge tone={statusTone[st] ?? "muted"}>{STATUS_LABELS[st]}</StatusBadge>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      важность: {SEVERITY_LABELS[a.severity] ?? a.severity}
                      <ChevronDown className={cn("size-4 transition-transform", isOpen ? "rotate-180" : "")} />
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.summary}</p>
                </button>
              </div>

              {isOpen ? (
                <div className="ml-6 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                  <p className="text-sm">{a.explanation}</p>
                  <p className="text-xs text-muted-foreground">
                    Обнаружено: {fmtDateTime(a.detected_at)}
                    {a.reviewedBy ? ` · разобрал(а): ${a.reviewedBy}` : ""}
                  </p>
                  {a.note ? <p className="text-xs text-muted-foreground">Комментарий: {a.note}</p> : null}
                  {a.links.length ? (
                    <div className="flex flex-wrap gap-2">
                      {a.links.map((l) => (
                        <Link key={l.href + l.label} href={l.href} className="flex items-center gap-1 text-sm text-primary underline">
                          <ExternalLink className="size-3.5" /> {l.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {st !== "confirmed" ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => updateAnomalyStatus(a.id, "confirmed", null))}>
                        <Check className="size-4" /> Подтвердить
                      </Button>
                    ) : null}
                    {st !== "dismissed" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => dismiss(a.id)}>
                        <X className="size-4" /> Снять
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => updateAnomalyStatus(a.id, "new", null))}>
                        Вернуть
                      </Button>
                    )}
                    {a.canPenalty && st !== "dismissed" ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => setPenaltyFor(penaltyFor === a.id ? null : a.id)}>
                        Создать штраф
                      </Button>
                    ) : null}
                    {a.type === "over_norm" && st !== "dismissed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          act(async () => {
                            const res = await generateClaim(a.id);
                            if (res.ok) toast.success(`Претензия сформирована: ${res.number} (см. «Документы»)`);
                            return res;
                          })
                        }
                      >
                        Претензия (docx)
                      </Button>
                    ) : null}
                  </div>

                  {penaltyFor === a.id ? (
                    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs">Сумма, ₸</label>
                        <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="h-9 w-32" />
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-xs">Основание</label>
                        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" placeholder="Превышение норматива расхода ГСМ" />
                      </div>
                      <Button size="sm" loading={pending} onClick={() => submitPenalty(a.id)}>Удержать</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {pageRows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Аномалий по выбранным фильтрам нет"
            description="Всё разобрано — или измените фильтры, чтобы посмотреть остальные."
            className="border-0"
          />
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ← Назад
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {safePage + 1} / {pageCount} · всего {visible.length}
          </span>
          <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            Вперёд →
          </Button>
        </div>
      ) : null}
    </div>
  );
}
