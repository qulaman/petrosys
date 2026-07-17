-- =============================================================================
-- QuarryOps · Миграция 0008 — детектор аномалий, дедуп, RPC пересчёта, pg_cron
-- Реализованы 6 детекторов, устойчивых на текущих данных:
--   fuel_no_work, hours_over_11, driver_double_shift, unapproved_unit,
--   tanker_gap, over_norm.
-- Отложены (нужны статистика/многодневность/Фаза 3):
--   short_trip_interval, continuous_driving, work_no_fuel, unmatched_txn.
-- =============================================================================

-- Дедуп: одна аномалия на сущность/период. Повторный прогон не плодит дубли и
-- не воскрешает уже разобранные (on conflict do nothing сохраняет статус).
alter table public.anomalies add column if not exists dedup_key text;
create unique index if not exists anomalies_org_dedup_uniq
  on public.anomalies (org_id, dedup_key);

-- -----------------------------------------------------------------------------
-- Детектор за период [p_from, p_to] для одной организации. Возвращает число
-- новых аномалий. SECURITY DEFINER — считает в обход RLS, org_id проставляем явно.
-- -----------------------------------------------------------------------------
create or replace function public.detect_anomalies(p_org_id uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
  v_after  bigint;
  v_month_start date := date_trunc('month', p_to)::date;
begin
  select count(*) into v_before from anomalies where org_id = p_org_id;

  -- (6) Более 11 часов за смену
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'hours_over_11', 'medium',
         jsonb_build_object('shift_id', id, 'vehicle_id', vehicle_id, 'date', shift_date, 'hours', hours),
         'hours_over_11:' || id::text
  from shift_records
  where org_id = p_org_id and shift_date between p_from and p_to and hours > 11
  on conflict (org_id, dedup_key) do nothing;

  -- (5) Один водитель в день и ночь одной даты
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'driver_double_shift', 'medium',
         jsonb_build_object('driver_id', driver_id, 'date', shift_date),
         'driver_double_shift:' || driver_id::text || ':' || shift_date::text
  from shift_records
  where org_id = p_org_id and shift_date between p_from and p_to
  group by org_id, driver_id, shift_date
  having count(distinct shift_type) > 1
  on conflict (org_id, dedup_key) do nothing;

  -- (8) Расхождение замера бензовоза с расчётом > 20 л
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'tanker_gap', 'high',
         jsonb_build_object('measurement_id', id, 'tanker_id', tanker_id,
                            'diff', round(measured_liters - calculated_liters, 1)),
         'tanker_gap:' || id::text
  from tanker_measurements
  where org_id = p_org_id
    and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
    and abs(measured_liters - calculated_liters) > 20
  on conflict (org_id, dedup_key) do nothing;

  -- (1) Топливо выдано, а работы (рейсов/часов) в этот день нет
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select fi.org_id, 'fuel_no_work', 'medium',
         jsonb_build_object('vehicle_id', fi.vehicle_id, 'date', fi.d, 'liters', fi.liters),
         'fuel_no_work:' || fi.vehicle_id::text || ':' || fi.d::text
  from (
    select org_id, vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date as d, sum(liters) liters
    from fuel_issues
    where org_id = p_org_id
      and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
    group by org_id, vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date
  ) fi
  where not exists (
    select 1 from trip_records t
    where t.org_id = fi.org_id and t.vehicle_id = fi.vehicle_id
      and (t.created_at at time zone 'Asia/Aqtobe')::date = fi.d)
    and not exists (
    select 1 from shift_records s
    where s.org_id = fi.org_id and s.vehicle_id = fi.vehicle_id and s.shift_date = fi.d)
  on conflict (org_id, dedup_key) do nothing;

  -- (7) Недопущенная техника: смена вне периода approved_from/approved_to
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select s.org_id, 'unapproved_unit', 'medium',
         jsonb_build_object('kind', 'shift', 'record_id', s.id, 'vehicle_id', s.vehicle_id, 'date', s.shift_date),
         'unapproved_unit:shift:' || s.id::text
  from shift_records s
  join vehicles v on v.id = s.vehicle_id
  where s.org_id = p_org_id and s.shift_date between p_from and p_to
    and (v.approved_from is null
         or s.shift_date < v.approved_from
         or (v.approved_to is not null and s.shift_date > v.approved_to))
  on conflict (org_id, dedup_key) do nothing;

  -- (3) Расход выше норматива за месяц (л/моточас > fuel_norm_per_hour)
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select v.org_id, 'over_norm', 'high',
         jsonb_build_object('vehicle_id', v.id,
                            'actual', round(l.liters / h.hours, 1),
                            'norm', v.fuel_norm_per_hour,
                            'month', to_char(v_month_start, 'YYYY-MM')),
         'over_norm:' || v.id::text || ':' || to_char(v_month_start, 'YYYY-MM')
  from vehicles v
  join (
    select vehicle_id, sum(liters) liters from fuel_issues
    where org_id = p_org_id
      and (created_at at time zone 'Asia/Aqtobe')::date between v_month_start and p_to
    group by vehicle_id
  ) l on l.vehicle_id = v.id
  join (
    select vehicle_id, sum(hours) hours from shift_records
    where org_id = p_org_id and shift_date between v_month_start and p_to
    group by vehicle_id
  ) h on h.vehicle_id = v.id
  where v.org_id = p_org_id and v.accounting_type = 'hours'
    and v.fuel_norm_per_hour is not null and h.hours > 0
    and (l.liters / h.hours) > v.fuel_norm_per_hour
  on conflict (org_id, dedup_key) do nothing;

  select count(*) into v_after from anomalies where org_id = p_org_id;
  return (v_after - v_before)::int;
end;
$$;

-- Прогон по всем организациям (для cron) — последние 7 дней + месяц (over_norm).
create or replace function public.detect_all_anomalies()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o record;
begin
  for o in select id from organizations loop
    perform public.detect_anomalies(o.id, (current_date - 7), current_date);
  end loop;
end;
$$;

-- On-demand пересчёт для своей организации (кнопка в центре аномалий). office/admin.
create or replace function public.recompute_anomalies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_count int;
begin
  v_org := public.current_org_id();
  if v_org is null then return 0; end if;
  if not public.has_any_role(array['office', 'admin']) then
    raise exception 'Недостаточно прав';
  end if;
  v_count := public.detect_anomalies(v_org, (current_date - interval '31 days')::date, current_date);
  return v_count;
end;
$$;

grant execute on function public.recompute_anomalies() to authenticated;

-- -----------------------------------------------------------------------------
-- Ежедневный джоб через pg_cron (01:00 UTC ≈ 06:00 Актобе). Если pg_cron
-- недоступен — детекторы всё равно созданы, работает on-demand пересчёт.
-- -----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('quarryops-daily-anomalies', '0 1 * * *',
                        'select public.detect_all_anomalies();');
exception when others then
  raise notice 'pg_cron недоступен (%): ежедневный джоб не запланирован, on-demand работает', sqlerrm;
end;
$$;
