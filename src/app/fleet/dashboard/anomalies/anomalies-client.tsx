"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/format";
import { SEVERITY_LABELS, STATUS_LABELS } from "@/lib/anomalies";
import {
  createPenaltyFromAnomaly,
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
  summary: string;
  canPenalty: boolean;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Открытые" },
  { key: "new", label: "Новые" },
  { key: "confirmed", label: "Подтверждённые" },
  { key: "dismissed", label: "Снятые" },
  { key: "all", label: "Все" },
];

const statusColor: Record<string, string> = {
  new: "text-amber-600",
  reviewed: "text-blue-600",
  confirmed: "text-destructive",
  dismissed: "text-muted-foreground",
};

export function AnomaliesClient({ rows }: { rows: AnomalyRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("open");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [penaltyFor, setPenaltyFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const visible = rows.filter((r) =>
    filter === "all" ? true : filter === "open" ? r.status === "new" || r.status === "reviewed" : r.status === filter,
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string; count?: number }>) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) { setMsg(res.error ?? "Ошибка"); toast.error(res.error ?? "Ошибка"); }
      else {
        if (typeof res.count === "number") toast.success(`Пересчёт: +${res.count} новых аномалий`);
        router.refresh();
      }
    });
  }

  function dismiss(id: string) {
    const note = window.prompt("Комментарий к снятию (необязательно):") ?? "";
    act(() => updateAnomalyStatus(id, "dismissed", note || null));
  }

  function submitPenalty(id: string) {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setMsg("Введите сумму штрафа"); return; }
    act(async () => {
      const res = await createPenaltyFromAnomaly(id, amt, reason || "Превышение норматива расхода ГСМ");
      if (res.ok) { setPenaltyFor(null); setAmount(""); setReason(""); }
      return res;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="secondary" className="ml-auto" loading={pending} onClick={() => act(recomputeAction)}>
          <RefreshCw className="size-4" /> Пересчитать сейчас
        </Button>
      </div>

      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}

      <div className="flex flex-col divide-y rounded-lg border">
        {visible.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.typeLabel}</span>
              <span className="text-xs text-muted-foreground">важность: {SEVERITY_LABELS[a.severity] ?? a.severity}</span>
              <span className={`text-xs font-medium ${statusColor[a.status]}`}>{STATUS_LABELS[a.status]}</span>
              <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(a.detected_at)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{a.summary}</p>

            <div className="flex flex-wrap gap-2">
              {a.status !== "confirmed" ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => updateAnomalyStatus(a.id, "confirmed", null))}>
                  <Check className="size-4" /> Подтвердить
                </Button>
              ) : null}
              {a.status !== "dismissed" ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => dismiss(a.id)}>
                  <X className="size-4" /> Снять
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => updateAnomalyStatus(a.id, "new", null))}>
                  Вернуть
                </Button>
              )}
              {a.canPenalty && a.status !== "dismissed" ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setPenaltyFor(penaltyFor === a.id ? null : a.id)}>
                  Создать штраф
                </Button>
              ) : null}
              {a.type === "over_norm" && a.status !== "dismissed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      const res = await generateClaim(a.id);
                      if (res.ok) setMsg(`Претензия сформирована: ${res.number} (см. «Документы»)`);
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
        ))}
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Аномалий в этой категории нет</p>
        ) : null}
      </div>
    </div>
  );
}
