"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useNavProgress } from "@/components/nav-progress";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { AUDIT_SECTIONS } from "@/lib/audit-sections";
import type { AuditPage } from "@/lib/data/audit";
import { cn } from "@/lib/utils";

const ACTION_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Все действия" },
  { key: "insert", label: "Создание" },
  { key: "update", label: "Правка" },
  { key: "delete", label: "Удаление" },
];

const ACTION_TONE: Record<string, StatusTone> = {
  insert: "green",
  update: "amber",
  delete: "red",
};

export function AuditClient({
  data,
  filters,
}: {
  data: AuditPage;
  filters: { section: string | null; action: string | null; userId: string | null };
}) {
  const nav = useNavProgress();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  /** Навигация с обновлением фильтра: страница сбрасывается, период сохраняется. */
  function setParam(key: string, value: string | null) {
    const q = new URLSearchParams(sp.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    q.delete("page");
    nav.push(`${pathname}?${q.toString()}`);
  }
  function setPage(page: number) {
    const q = new URLSearchParams(sp.toString());
    if (page > 0) q.set("page", String(page));
    else q.delete("page");
    nav.push(`${pathname}?${q.toString()}`);
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {ACTION_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={(filters.action ?? "") === f.key ? "default" : "outline"}
              onClick={() => setParam("action", f.key || null)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <SearchSelect
          value={filters.section ?? ""}
          onChange={(v) => setParam("section", v || null)}
          options={Object.entries(AUDIT_SECTIONS).map(([value, s]) => ({ value, label: s.label }))}
          emptyLabel="Все разделы"
          triggerClassName="h-8 w-44"
        />
        <SearchSelect
          value={filters.userId ?? ""}
          onChange={(v) => setParam("user", v || null)}
          options={data.users.map((u) => ({ value: u.id, label: u.name }))}
          emptyLabel="Все сотрудники"
          triggerClassName="h-8 w-48"
        />
        <span className="ml-auto text-xs text-muted-foreground">всего записей: {fmtInt(data.total)}</span>
      </div>

      <div className="flex flex-col divide-y rounded-lg border">
        {data.rows.map((r) => {
          const isOpen = expanded.has(r.id);
          const preview = r.action === "update"
            ? r.diff.slice(0, 2).map((d) => `${d.label}: ${d.from} → ${d.to}`).join(" · ")
            : r.diff.slice(0, 3).map((d) => `${d.label}: ${d.to}`).join(" · ");
          return (
            <div key={r.id} className="flex flex-col gap-1 p-3 text-sm">
              <button type="button" onClick={() => toggle(r.id)} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
                <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDateTime(r.at)}</span>
                <span className="font-medium">{r.userName}</span>
                <StatusBadge tone={ACTION_TONE[r.action] ?? "muted"}>{r.actionLabel}</StatusBadge>
                <span>{r.entity}</span>
                <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", isOpen ? "rotate-180" : "")} />
              </button>
              {!isOpen && preview ? (
                <p className="pl-32 text-xs text-muted-foreground truncate">{preview}</p>
              ) : null}
              {isOpen ? (
                <div className="ml-32 mt-1 overflow-x-auto rounded-md border bg-muted/30">
                  <table className="text-xs">
                    <tbody className="divide-y">
                      {r.diff.map((d, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1 font-medium text-muted-foreground">{d.label}</td>
                          {r.action === "update" ? (
                            <>
                              <td className="px-2 py-1 text-destructive/80 line-through">{d.from}</td>
                              <td className="px-2 py-1">{d.to}</td>
                            </>
                          ) : (
                            <td className="px-2 py-1" colSpan={2}>{d.to}</td>
                          )}
                        </tr>
                      ))}
                      {r.diff.length === 0 ? (
                        <tr><td className="px-2 py-1 text-muted-foreground">Деталей нет</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
        {data.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Записей нет"
            description="Измените период или фильтры — журнал пишется с момента включения аудита."
            className="border-0 p-8"
          />
        ) : null}
      </div>

      {data.pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>
            ← Назад
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {data.page + 1} / {data.pageCount}
          </span>
          <Button size="sm" variant="outline" disabled={data.page >= data.pageCount - 1} onClick={() => setPage(data.page + 1)}>
            Вперёд →
          </Button>
        </div>
      ) : null}
    </div>
  );
}
