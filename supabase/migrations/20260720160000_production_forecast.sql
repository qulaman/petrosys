-- =============================================================================
-- QuarryOps · Миграция 0020 — сводки геодезиста и параметры прогноза объёма
-- production_facts: дневные объёмы перевозки (м³) по потокам — полная картина
-- производства (вся техника, включая непокрытую Рейсами). forecast_settings:
-- якорь/цель/коэффициенты для модуля прогнозирования (вкладка «Объём»).
-- =============================================================================

create table public.production_facts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org_id()
              references public.organizations(id),
  work_date   date not null,
  shift_type  text check (shift_type in ('day', 'night')),  -- null = за сутки
  -- поток перевозки; null допустим только для дня-простоя
  flow        text check (flow in ('pit', 'local', 'stockpile', 'prs', 'total')),
  trips_count integer check (trips_count >= 0),
  volume_m3   numeric(10, 2) check (volume_m3 >= 0),
  day_status  text not null default 'work'
              check (day_status in ('work', 'downtime_weather', 'downtime_tech')),
  note        text,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);
comment on table public.production_facts is
  'Дневные сводки геодезиста по объёмам перевозки (м³): источник факта для прогноза.';
comment on column public.production_facts.flow is
  'pit=с карьера, local=по месту, stockpile=с накопителя, prs=ПРС, total=не детализировано';

create unique index production_facts_uniq
  on public.production_facts (org_id, work_date, coalesce(shift_type, '-'), coalesce(flow, '-'));
create index production_facts_org_date on public.production_facts (org_id, work_date desc);

create table public.forecast_settings (
  org_id              uuid primary key default public.current_org_id()
                      references public.organizations(id),
  baseline_date       date not null default '2026-07-01',
  baseline_volume_m3  numeric(12, 2) not null default 150000,  -- пример из ТЗ, уточняется заказчиком
  target_volume_m3    numeric(12, 2) not null default 500000,  -- пример из ТЗ, уточняется заказчиком
  target_date         date,                                    -- задана → считаем требуемую технику
  trucks_per_excavator integer not null default 10,            -- норма 1:10 (смены 3/30, 5/50)
  availability_coeff  numeric(4, 2) not null default 0.75,     -- доступность техники (ОЕЕ грубо)
  trips_per_truck_shift integer not null default 15,           -- рейсов на самосвал за смену
  updated_at          timestamptz not null default now()
);
insert into public.forecast_settings (org_id) select id from public.organizations
on conflict (org_id) do nothing;

-- -----------------------------------------------------------------------------
-- RLS: сводки видит и вводит персонал (подрядчику — нет); параметры пишет офис.
-- -----------------------------------------------------------------------------
alter table public.production_facts enable row level security;
alter table public.forecast_settings enable row level security;

create policy "staff read production_facts"
  on public.production_facts for select to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['admin','office','itr','checker','fueler']));

create policy "itr insert production_facts"
  on public.production_facts for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['admin','office','itr']));

create policy "office manage production_facts"
  on public.production_facts for update to authenticated
  using (org_id = public.current_org_id() and public.has_any_role(array['admin','office']))
  with check (org_id = public.current_org_id() and public.has_any_role(array['admin','office']));

create policy "office delete production_facts"
  on public.production_facts for delete to authenticated
  using (org_id = public.current_org_id() and public.has_any_role(array['admin','office','itr']));

create policy "staff read forecast_settings"
  on public.forecast_settings for select to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['admin','office','itr','checker','fueler']));

create policy "office manage forecast_settings"
  on public.forecast_settings for all to authenticated
  using (org_id = public.current_org_id() and public.has_any_role(array['office','admin']))
  with check (org_id = public.current_org_id() and public.has_any_role(array['office','admin']));
