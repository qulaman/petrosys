-- =============================================================================
-- QuarryOps · Миграция 0011 — журнал смены в 3 этапа
-- 1) draft   — предварительный перечень техники на линии (с нуля или
--              наследованием предыдущей смены);
-- 2) filling — заполнение/корректировка часов + подпись каждого работника;
-- 3) closed  — закрытие журнала подписью мастера (ИТР), журнал блокируется.
-- Строки журнала — существующие shift_records, привязанные через journal_id.
-- =============================================================================

create table public.shift_journals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default public.current_org_id()
                    references public.organizations(id),
  shift_date        date not null,
  shift_type        text not null check (shift_type in ('day', 'night')),
  work_type_id      uuid references public.work_types(id),
  status            text not null default 'draft'
                    check (status in ('draft', 'filling', 'closed')),
  itr_signature_url text,
  created_by        uuid not null default auth.uid() references auth.users(id),
  closed_by         uuid references auth.users(id),
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (org_id, shift_date, shift_type)   -- один журнал на смену
);

comment on table public.shift_journals is
  'Журнал смены: перечень техники (draft) → часы+подписи работников (filling) → подпись мастера (closed).';

create index shift_journals_org_date_idx on public.shift_journals (org_id, shift_date desc);

-- Строки журнала.
alter table public.shift_records
  add column journal_id uuid references public.shift_journals(id) on delete set null;

create index shift_records_journal_idx on public.shift_records (journal_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.shift_journals enable row level security;

create policy "staff read shift_journals"
  on public.shift_journals for select to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['itr', 'office', 'admin']));

create policy "itr insert shift_journals"
  on public.shift_journals for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['itr', 'admin'])
              and created_by = auth.uid());

-- Правки журнала (статусы, вид работ, подпись мастера) — ИТР/офис/админ.
create policy "itr update shift_journals"
  on public.shift_journals for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['itr', 'office', 'admin']))
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['itr', 'office', 'admin']));

-- Удаление строк перечня при корректировке (draft/filling).
create policy "itr delete own shift_records"
  on public.shift_records for delete to authenticated
  using (org_id = public.current_org_id()
         and (public.has_any_role(array['office', 'admin']) or itr_id = auth.uid()));
