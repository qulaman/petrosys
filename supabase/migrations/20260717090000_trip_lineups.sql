-- =============================================================================
-- QuarryOps · Миграция 0017 — вывод самосвалов на линию (рейсы в 2 этапа)
-- Этап 1: учётчик формирует перечень самосвалов на линии на смену
--         (с чистого листа или наследованием предыдущей смены);
-- Этап 2: рейсы фиксируются только по машинам из перечня; добавить машину
--         на линию можно в любой момент смены.
-- =============================================================================

create table public.trip_lineups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org_id()
             references public.organizations(id),
  work_date  date not null,
  shift_type text not null check (shift_type in ('day', 'night')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, work_date, shift_type)   -- один перечень на смену
);

comment on table public.trip_lineups is
  'Вывод самосвалов на линию: перечень машин на смену, рейсы бьются только по ним.';

create table public.trip_lineup_vehicles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org_id()
             references public.organizations(id),
  lineup_id  uuid not null references public.trip_lineups(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id),
  added_by   uuid not null default auth.uid() references auth.users(id),
  added_at   timestamptz not null default now(),
  unique (lineup_id, vehicle_id)
);

create index trip_lineups_org_date_idx on public.trip_lineups (org_id, work_date desc);
create index trip_lineup_vehicles_lineup_idx on public.trip_lineup_vehicles (lineup_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.trip_lineups enable row level security;
alter table public.trip_lineup_vehicles enable row level security;

create policy "staff read trip_lineups"
  on public.trip_lineups for select to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['checker', 'office', 'admin']));

create policy "checker insert trip_lineups"
  on public.trip_lineups for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['checker', 'admin'])
              and created_by = auth.uid());

create policy "staff read trip_lineup_vehicles"
  on public.trip_lineup_vehicles for select to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['checker', 'office', 'admin']));

create policy "checker insert trip_lineup_vehicles"
  on public.trip_lineup_vehicles for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['checker', 'admin'])
              and added_by = auth.uid());

-- Снять машину с линии (пока по ней нет рейсов — проверяется в приложении).
create policy "staff delete trip_lineup_vehicles"
  on public.trip_lineup_vehicles for delete to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['checker', 'office', 'admin']));
