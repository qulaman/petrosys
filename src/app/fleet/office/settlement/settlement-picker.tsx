"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileSignature, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { ContractorOption } from "@/lib/data/avr";
import type { ContractOption } from "@/lib/data/settlement";

const TYPE_LABELS: Record<string, string> = {
  all: "Все договоры",
  transportation: "Перевозка",
  equipment: "Услуги техники",
};

/** Выбор на странице закрытия: поиск по ИП и номеру договора + фильтр по типу. */
export function SettlementPicker({
  contractors,
  contracts,
}: {
  contractors: ContractorOption[];
  contracts: ContractOption[];
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");

  const norm = (s: string) => s.toLowerCase().replace(/[«»"]/g, "").trim();
  const query = norm(q);

  const filteredContractors = useMemo(
    () => contractors.filter((c) => !query || norm(c.name).includes(query)),
    [contractors, query],
  );
  const filteredContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          (type === "all" || c.contract_type === type) &&
          (!query || norm(c.number).includes(query) || norm(c.contractor).includes(query)),
      ),
    [contracts, query, type],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: ИП или номер договора"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(TYPE_LABELS).map(([k, label]) => (
            <Button key={k} size="sm" variant={type === k ? "default" : "outline"} onClick={() => setType(k)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      <section>
        <p className="mb-3 text-sm text-muted-foreground">
          АВР по ИП — свод по машинам контрагента ({filteredContractors.length}):
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredContractors.map((c) => (
            <Link key={c.id} href={`/fleet/office/settlement?contractor=${c.id}`} className="rounded-lg border p-4 hover:bg-accent">
              <p className="flex items-center gap-2 font-medium">
                <Users className="size-4 shrink-0 text-primary" />
                {c.name}
              </p>
              <p className="text-xs text-muted-foreground">машин: {c.vehicles}</p>
            </Link>
          ))}
          {filteredContractors.length === 0 ? (
            <EmptyState
              icon={Users}
              title={query ? "Никого не найдено" : "Контрагентов с машинами нет"}
              description={query ? "Измените запрос поиска." : "Привяжите машины к контрагентам в «Справочники → Техника»."}
              className="sm:col-span-2 lg:col-span-3"
            />
          ) : null}
        </div>
      </section>

      <section>
        <p className="mb-3 text-sm text-muted-foreground">
          Расчёт по отдельному договору ({filteredContracts.length}):
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredContracts.map((c) => (
            <Link key={c.id} href={`/fleet/office/settlement?contract=${c.id}`} className="rounded-lg border p-4 hover:bg-accent">
              <p className="flex items-center gap-2 font-medium">
                <FileSignature className="size-4 shrink-0 text-primary" />
                {c.number}
              </p>
              <p className="text-sm text-muted-foreground">{c.contractor}</p>
              <p className="text-xs text-muted-foreground">
                {c.contract_type === "transportation" ? "перевозка" : "услуги техники"} · АВР {c.billing_period === "15days" ? "15 дней" : "месяц"}
              </p>
            </Link>
          ))}
          {filteredContracts.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title={query || type !== "all" ? "Договоры не найдены" : "Договоров нет"}
              description={query || type !== "all" ? "Измените запрос или фильтр." : "Добавьте договор в «Справочники → Договоры и прайсы»."}
              className="sm:col-span-2 lg:col-span-3"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
