-- =============================================================================
-- QuarryOps · Миграция 0002 — доменная схема Фазы 1
-- Все таблицы учёта: контрагенты, договоры, прайсы, техника, водители,
-- топливо (карты/бензовозы/выдачи), табель, рейсы, простои, штрафы,
-- документы, аномалии. У КАЖДОЙ таблицы — org_id (мультитенантность).
-- RLS-политики — в следующей миграции.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Общие триггеры-хелперы
-- -----------------------------------------------------------------------------

-- Автопростановка org_id текущего пользователя при вставке (если не задан).
create or replace function public.set_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    new.org_id := public.current_org_id();
  end if;
  return new;
end;
$$;

-- Профиль подрядчика: теперь можно добавить FK (contractors появились ниже —
-- поэтому FK навешиваем в конце файла).

-- =============================================================================
-- СПРАВОЧНИКИ КОНТРАГЕНТОВ И ДОГОВОРОВ
-- =============================================================================

-- Контрагенты: субподрядчики (ИП) и заказчики.
create table public.contractors (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  counterparty_type text not null default 'subcontractor'
                    check (counterparty_type in ('subcontractor', 'client')),
  name             text not null,
  bin              text,
  legal_address    text,
  bank_name        text,
  iik              text,
  bik              text,
  head_name        text,
  vat_payer        boolean not null default false,
  contact_phone    text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
comment on column public.contractors.vat_payer is
  'Плательщик НДС. Определяет НДС для всех договоров; цены в price_list хранятся как в договоре (с НДС у плательщика, без — у остальных).';

-- Договоры с контрагентами.
create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  contractor_id  uuid not null references public.contractors(id),
  number         text not null,
  contract_type  text not null check (contract_type in ('transportation', 'equipment')),
  billing_period text not null default 'monthly'
                 check (billing_period in ('monthly', '15days')),
  valid_from     date not null,
  valid_to       date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on column public.contracts.contract_type is
  'transportation (перевозка): единицы рейс и час; equipment (услуги техники): только час.';

-- =============================================================================
-- ТЕХНИКА И ВОДИТЕЛИ
-- =============================================================================

create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  contractor_id      uuid references public.contractors(id),   -- null = собственная
  contract_id        uuid references public.contracts(id),
  brand              text not null,
  reg_number         text not null,
  vehicle_type       text not null,        -- dump_truck, grader, excavator, dozer, roller, water_truck
  accounting_type    text not null check (accounting_type in ('hours', 'trips')),
  fuel_norm_per_hour numeric(6, 2),        -- норматив л/час из Приложения №2
  approved_from      date,
  approved_to        date,
  qr_code            text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (org_id, reg_number),
  unique (org_id, qr_code)
);

create table public.drivers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  contractor_id uuid references public.contractors(id),
  full_name     text not null,
  iin           text,
  phone         text,
  approved_from date,
  approved_to   date,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- =============================================================================
-- ПРАЙС-ЛИСТЫ ДОГОВОРОВ (effective-dated)
-- =============================================================================

-- Цена = f(вид техники, единица). Доп. соглашение = НОВАЯ строка с новым valid_from.
create table public.price_list (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  contract_id  uuid not null references public.contracts(id),
  vehicle_type text not null,
  unit         text not null check (unit in ('trip', 'hour')),
  price        numeric(10, 2) not null,
  vehicle_id   uuid references public.vehicles(id),  -- null = на весь вид техники
  valid_from   date not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- Цена ГСМ для удержания (effective-dated, «как в договоре» по vat_payer).
create table public.contract_fuel_prices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  contract_id     uuid not null references public.contracts(id),
  price_per_liter numeric(10, 2) not null,
  valid_from      date not null,
  note            text,
  created_at      timestamptz not null default now()
);

-- =============================================================================
-- ТОПЛИВО: КАРТЫ, БЕНЗОВОЗЫ, ВЫДАЧИ, ТРАНЗАКЦИИ
-- =============================================================================

create table public.fuel_cards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  card_number text not null,          -- Карта №1..4 / внутренний номер
  operator    text,                   -- Helios, КМГ, Sinooil…
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.tankers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  name            text not null,
  capacity_liters numeric(10, 2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Транзакции из выписки оператора (загружаются в Фазе 3, таблица нужна для FK).
create table public.card_transactions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  fuel_card_id    uuid not null references public.fuel_cards(id),
  transaction_at  timestamptz not null,
  liters          numeric(10, 2) not null,
  amount          numeric(12, 2),
  station         text,
  import_batch_id uuid,
  match_status    text not null default 'unmatched'
                  check (match_status in ('unmatched', 'auto', 'manual', 'ignored')),
  created_at      timestamptz not null default now(),
  unique (fuel_card_id, transaction_at, liters)  -- защита от дублей при повторной загрузке
);

-- Приход топлива в бензовоз.
create table public.tanker_refills (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  tanker_id         uuid not null references public.tankers(id),
  liters            numeric(10, 2) not null check (liters > 0),
  price_per_liter   numeric(10, 2),
  source            text,
  fuel_card_id      uuid references public.fuel_cards(id),
  receipt_photo_url text,
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now()
);

-- Замеры фактического остатка бензовоза (инвентаризация).
create table public.tanker_measurements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  tanker_id        uuid not null references public.tankers(id),
  measured_liters  numeric(10, 2) not null,
  calculated_liters numeric(10, 2) not null,  -- расчётный остаток на момент замера (фиксируем)
  note             text,
  created_by       uuid not null default auth.uid() references auth.users(id),
  created_at       timestamptz not null default now()
);

-- ЕДИНАЯ таблица выдач топлива (карта + бензовоз).
create table public.fuel_issues (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  source_type           text not null check (source_type in ('card', 'tanker')),
  fuel_card_id          uuid references public.fuel_cards(id),
  tanker_id             uuid references public.tankers(id),
  vehicle_id            uuid not null references public.vehicles(id),
  driver_id             uuid not null references public.drivers(id),
  liters                numeric(10, 2) not null check (liters > 0),
  odometer              numeric(12, 1),
  receipt_photo_url     text,
  driver_signature_url  text not null,
  geo_lat               numeric(9, 6),
  geo_lng               numeric(9, 6),
  issued_by             uuid not null default auth.uid() references auth.users(id),
  matched_transaction_id uuid references public.card_transactions(id),
  created_at            timestamptz not null default now(),
  constraint fuel_issues_source_ref check (
    (source_type = 'card'   and fuel_card_id is not null) or
    (source_type = 'tanker' and tanker_id   is not null)
  )
);

-- =============================================================================
-- РАБОТА: ТАБЕЛЬ СМЕН, МАРШРУТЫ, РЕЙСЫ
-- =============================================================================

create table public.work_types (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.routes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null,
  distance_km numeric(6, 2),
  material    text,
  volume_m3   numeric(6, 2),   -- объём кузова/рейса для метрики тенге/м³ (min 19 по договору)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Табель: смены техники по моточасам.
create table public.shift_records (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id),
  vehicle_id           uuid not null references public.vehicles(id),
  driver_id            uuid not null references public.drivers(id),
  work_type_id         uuid references public.work_types(id),
  shift_date           date not null,
  shift_type           text not null check (shift_type in ('day', 'night')),
  hours                numeric(4, 1) not null check (hours > 0 and hours <= 24),
  driver_signature_url text,
  itr_id               uuid not null default auth.uid() references auth.users(id),
  itr_signature_url    text,
  created_at           timestamptz not null default now(),
  unique (vehicle_id, shift_date, shift_type)   -- одна запись на машину на смену
);

-- Рейсы (по событию, каждая ходка = запись). Цифровая замена ТТН.
create table public.trip_records (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id),
  vehicle_id           uuid not null references public.vehicles(id),
  driver_id            uuid not null references public.drivers(id),
  route_id             uuid not null references public.routes(id),
  recorded_by          uuid not null default auth.uid() references auth.users(id),
  driver_signature_url text,
  source               text not null default 'checker'
                       check (source in ('checker', 'driver', 'gps')),
  geo_lat              numeric(9, 6),
  geo_lng              numeric(9, 6),
  created_at           timestamptz not null default now()
);

-- =============================================================================
-- ПРОСТОИ, ШТРАФЫ (таблицы в Фазе 1, интерфейсы — Фаза 5)
-- =============================================================================

create table public.downtime_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  vehicle_id    uuid not null references public.vehicles(id),
  downtime_date date not null,
  fault_side    text not null check (fault_side in ('contractor', 'client')),
  reason        text not null,
  notified_at   timestamptz,     -- для проверки правила 18:00
  hours         numeric(4, 1),
  created_by    uuid not null default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now()
);

create table public.penalties (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  contract_id       uuid not null references public.contracts(id),
  amount            numeric(12, 2) not null,
  reason            text not null,
  penalty_date      date not null,
  settled_in_period text,        -- в каком закрытии удержано; null = ещё нет
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now()
);

-- =============================================================================
-- ДОКУМЕНТЫ (Фаза 6) и АНОМАЛИИ (Фаза 4) — таблицы заводим сразу
-- =============================================================================

create table public.generated_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  contract_id uuid not null references public.contracts(id),
  doc_type    text not null check (doc_type in (
                'contract', 'appendix1', 'appendix2', 'amendment', 'avr',
                'reconciliation_act', 'trip_register', 'fuel_statement',
                'claim_overconsumption', 'downtime_act')),
  number      text not null,
  period_from date,
  period_to   date,
  source_refs jsonb,
  file_url    text not null,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);

create table public.anomalies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  type            text not null,       -- fuel_no_work, work_no_fuel, over_norm, …
  severity        text not null default 'medium'
                  check (severity in ('low', 'medium', 'high')),
  entity_refs     jsonb,
  detected_at     timestamptz not null default now(),
  status          text not null default 'new'
                  check (status in ('new', 'reviewed', 'confirmed', 'dismissed')),
  resolution_note text,
  reviewed_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

-- =============================================================================
-- FK profiles.contractor_id (contractors уже создана)
-- =============================================================================
alter table public.profiles
  add constraint profiles_contractor_id_fkey
  foreign key (contractor_id) references public.contractors(id);

-- =============================================================================
-- Триггеры автопростановки org_id на все доменные таблицы
-- =============================================================================
do $$
declare
  t text;
  domain_tables text[] := array[
    'contractors', 'contracts', 'vehicles', 'drivers', 'price_list',
    'contract_fuel_prices', 'fuel_cards', 'tankers', 'card_transactions',
    'tanker_refills', 'tanker_measurements', 'fuel_issues', 'work_types',
    'routes', 'shift_records', 'trip_records', 'downtime_records',
    'penalties', 'generated_documents', 'anomalies'
  ];
begin
  foreach t in array domain_tables loop
    execute format(
      'create trigger set_org_id_%1$s before insert on public.%1$s
         for each row execute function public.set_org_id();', t);
  end loop;
end;
$$;

-- =============================================================================
-- Полезные индексы под частые выборки
-- =============================================================================
create index vehicles_org_active_idx      on public.vehicles (org_id, is_active);
create index drivers_org_active_idx       on public.drivers (org_id, is_active);
create index fuel_issues_vehicle_idx      on public.fuel_issues (vehicle_id, created_at);
create index fuel_issues_org_created_idx  on public.fuel_issues (org_id, created_at);
create index tanker_refills_tanker_idx    on public.tanker_refills (tanker_id, created_at);
create index tanker_meas_tanker_idx       on public.tanker_measurements (tanker_id, created_at);
create index shift_records_org_date_idx   on public.shift_records (org_id, shift_date);
create index trip_records_veh_created_idx on public.trip_records (vehicle_id, created_at);
create index trip_records_org_created_idx on public.trip_records (org_id, created_at);
create index price_list_lookup_idx        on public.price_list (contract_id, unit, vehicle_type, valid_from);
create index card_tx_card_time_idx        on public.card_transactions (fuel_card_id, transaction_at);

-- =============================================================================
-- VIEW: расчётный баланс бензовоза
-- Остаток = последний замер + приходы после замера − выдачи (tanker) после замера.
-- security_invoker — RLS нижележащих таблиц применяется к вызывающему.
-- =============================================================================
create view public.tanker_balances
with (security_invoker = on)
as
with last_measurement as (
  select distinct on (tanker_id)
    tanker_id, measured_liters, created_at
  from public.tanker_measurements
  order by tanker_id, created_at desc
)
select
  t.id     as tanker_id,
  t.org_id as org_id,
  t.name   as name,
  coalesce(lm.measured_liters, 0)
    + coalesce((
        select sum(r.liters) from public.tanker_refills r
        where r.tanker_id = t.id
          and (lm.created_at is null or r.created_at > lm.created_at)
      ), 0)
    - coalesce((
        select sum(fi.liters) from public.fuel_issues fi
        where fi.tanker_id = t.id and fi.source_type = 'tanker'
          and (lm.created_at is null or fi.created_at > lm.created_at)
      ), 0)
    as calculated_liters,
  lm.measured_liters as last_measured_liters,
  lm.created_at      as last_measured_at
from public.tankers t
left join last_measurement lm on lm.tanker_id = t.id;
