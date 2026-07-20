-- =============================================================================
-- QuarryOps · Миграция 0018 — детектор «работа без топлива» с учётом сменности
-- Правка заказчика 20.07: самосвалы в 2 смены заправляются каждый день,
-- в 1 смену — раз в два дня, прочая техника — раз в несколько дней; отсутствие
-- заправки в моменте нормально, если заправка была несколько дней назад.
--   org_settings: + no_fuel_days_trips_single (порог односменных самосвалов),
--   no_fuel_days_hours: default 3 → 5.
--   detect_anomalies: work_no_fuel различает 1/2-сменные самосвалы по ночным
--   выводам на линию / ночным сменам табеля в окне.
-- =============================================================================

alter table public.org_settings
  add column if not exists no_fuel_days_trips_single integer not null default 3;

alter table public.org_settings alter column no_fuel_days_hours set default 5;
update public.org_settings set no_fuel_days_hours = 5 where no_fuel_days_hours = 3;

comment on column public.org_settings.no_fuel_days_trips is
  'Дней работы без заправки до аномалии: самосвалы в 2 смены (заправка каждый день)';
comment on column public.org_settings.no_fuel_days_trips_single is
  'Дней работы без заправки до аномалии: самосвалы в 1 смену (заправка раз в 2 дня)';
comment on column public.org_settings.no_fuel_days_hours is
  'Дней работы без заправки до аномалии: техника на моточасах (заправка раз в несколько дней)';

-- -----------------------------------------------------------------------------
create or replace function public.detect_anomalies(p_org_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_before bigint; v_after bigint;
  v_month_start date := date_trunc('month', p_to)::date;
  v_gap numeric; v_nf_trips int; v_nf_hours int; v_nf_single int;
begin
  select count(*) into v_before from anomalies where org_id = p_org_id;
  select coalesce(tanker_gap_liters,20), coalesce(no_fuel_days_trips,2),
         coalesce(no_fuel_days_hours,5), coalesce(no_fuel_days_trips_single,3)
    into v_gap, v_nf_trips, v_nf_hours, v_nf_single
    from org_settings where org_id = p_org_id;
  if v_gap is null then v_gap := 20; v_nf_trips := 2; v_nf_hours := 5; v_nf_single := 3; end if;

  -- (6) > 11 часов
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'hours_over_11', 'medium',
         jsonb_build_object('shift_id', id, 'vehicle_id', vehicle_id, 'date', shift_date, 'hours', hours),
         'hours_over_11:' || id::text
  from shift_records
  where org_id = p_org_id and shift_date between p_from and p_to and hours > 11
  on conflict (org_id, dedup_key) do nothing;

  -- (5) водитель день+ночь
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'driver_double_shift', 'medium',
         jsonb_build_object('driver_id', driver_id, 'date', shift_date),
         'driver_double_shift:' || driver_id::text || ':' || shift_date::text
  from shift_records
  where org_id = p_org_id and shift_date between p_from and p_to
  group by org_id, driver_id, shift_date
  having count(distinct shift_type) > 1
  on conflict (org_id, dedup_key) do nothing;

  -- (8) расхождение бензовоза > порога из настроек
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select org_id, 'tanker_gap', 'high',
         jsonb_build_object('measurement_id', id, 'tanker_id', tanker_id,
                            'diff', round(measured_liters - calculated_liters, 1)),
         'tanker_gap:' || id::text
  from tanker_measurements
  where org_id = p_org_id
    and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
    and abs(measured_liters - calculated_liters) > v_gap
  on conflict (org_id, dedup_key) do nothing;

  -- (1) топливо без работы
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select fi.org_id, 'fuel_no_work', 'medium',
         jsonb_build_object('vehicle_id', fi.vehicle_id, 'date', fi.d, 'liters', fi.liters),
         'fuel_no_work:' || fi.vehicle_id::text || ':' || fi.d::text
  from (
    select org_id, vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date as d, sum(liters) liters
    from fuel_issues
    where org_id = p_org_id and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
    group by 1, 2, 3
  ) fi
  where not exists (select 1 from trip_records t where t.org_id = fi.org_id and t.vehicle_id = fi.vehicle_id
                    and (t.created_at at time zone 'Asia/Aqtobe')::date = fi.d)
    and not exists (select 1 from shift_records s where s.org_id = fi.org_id and s.vehicle_id = fi.vehicle_id
                    and s.shift_date = fi.d)
  on conflict (org_id, dedup_key) do nothing;

  -- (7) недопущенная техника
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select s.org_id, 'unapproved_unit', 'medium',
         jsonb_build_object('kind', 'shift', 'record_id', s.id, 'vehicle_id', s.vehicle_id, 'date', s.shift_date),
         'unapproved_unit:shift:' || s.id::text
  from shift_records s join vehicles v on v.id = s.vehicle_id
  where s.org_id = p_org_id and s.shift_date between p_from and p_to
    and (v.approved_from is null or s.shift_date < v.approved_from
         or (v.approved_to is not null and s.shift_date > v.approved_to))
  on conflict (org_id, dedup_key) do nothing;

  -- (3) расход выше норматива (месяц)
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select v.org_id, 'over_norm', 'high',
         jsonb_build_object('vehicle_id', v.id, 'actual', round(l.liters / h.hours, 1),
                            'norm', v.fuel_norm_per_hour, 'month', to_char(v_month_start, 'YYYY-MM')),
         'over_norm:' || v.id::text || ':' || to_char(v_month_start, 'YYYY-MM')
  from vehicles v
  join (select vehicle_id, sum(liters) liters from fuel_issues
        where org_id = p_org_id and (created_at at time zone 'Asia/Aqtobe')::date between v_month_start and p_to
        group by 1) l on l.vehicle_id = v.id
  join (select vehicle_id, sum(hours) hours from shift_records
        where org_id = p_org_id and shift_date between v_month_start and p_to group by 1) h on h.vehicle_id = v.id
  where v.org_id = p_org_id and v.accounting_type = 'hours'
    and v.fuel_norm_per_hour is not null and h.hours > 0
    and (l.liters / h.hours) > v.fuel_norm_per_hour
  on conflict (org_id, dedup_key) do nothing;

  -- (2) РАБОТА БЕЗ ТОПЛИВА с учётом сменности: порог = сколько дней подряд
  -- машина может работать без единой заправки, прежде чем это аномалия.
  --   самосвал с ночными выводами/сменами в окне (2 смены) — v_nf_trips (2)
  --   самосвал в 1 смену — v_nf_single (3)
  --   техника на моточасах — v_nf_hours (5)
  -- Заправка внутри окна снимает флаг: «не заправлялся сегодня» — не аномалия.
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select v.org_id, 'work_no_fuel', 'medium',
         jsonb_build_object('vehicle_id', v.id, 'days', n.days, 'to', p_to),
         'work_no_fuel:' || v.id::text || ':' || p_to::text
  from vehicles v
  cross join lateral (
    select case
      when v.accounting_type <> 'trips' then v_nf_hours
      when exists (select 1 from trip_lineups l
                   join trip_lineup_vehicles lv on lv.lineup_id = l.id
                   where lv.vehicle_id = v.id and l.org_id = v.org_id
                     and l.shift_type = 'night'
                     and l.work_date > p_to - v_nf_single and l.work_date <= p_to)
        or exists (select 1 from shift_records s
                   where s.vehicle_id = v.id and s.org_id = v.org_id
                     and s.shift_type = 'night'
                     and s.shift_date > p_to - v_nf_single and s.shift_date <= p_to)
      then v_nf_trips
      else v_nf_single
    end as days
  ) n
  where v.org_id = p_org_id and v.is_active
    and (select count(distinct d) from (
           select (created_at at time zone 'Asia/Aqtobe')::date d from trip_records
             where vehicle_id = v.id and (created_at at time zone 'Asia/Aqtobe')::date > p_to - n.days and (created_at at time zone 'Asia/Aqtobe')::date <= p_to
           union
           select shift_date from shift_records
             where vehicle_id = v.id and shift_date > p_to - n.days and shift_date <= p_to
         ) w) >= n.days
    and not exists (select 1 from fuel_issues f where f.vehicle_id = v.id
                    and (f.created_at at time zone 'Asia/Aqtobe')::date > p_to - n.days
                    and (f.created_at at time zone 'Asia/Aqtobe')::date <= p_to)
  on conflict (org_id, dedup_key) do nothing;

  -- (4) ПОДОЗРИТЕЛЬНЫЙ ИНТЕРВАЛ: < 50% медианы машины за день (≥3 интервалов)
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select p_org_id, 'short_trip_interval', 'medium',
         jsonb_build_object('trip_id', t.id, 'vehicle_id', t.vehicle_id, 'date', t.d,
                            'gap_min', round(t.gap_min::numeric, 0), 'median_min', round(m.med::numeric, 0)),
         'short_trip_interval:' || t.id::text
  from (
    select id, vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date d,
           extract(epoch from created_at - lag(created_at) over
             (partition by vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date order by created_at)) / 60 as gap_min
    from trip_records
    where org_id = p_org_id and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
  ) t
  join (
    select vehicle_id, d, percentile_cont(0.5) within group (order by gap_min) med, count(*) cnt
    from (
      select vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date d,
             extract(epoch from created_at - lag(created_at) over
               (partition by vehicle_id, (created_at at time zone 'Asia/Aqtobe')::date order by created_at)) / 60 as gap_min
      from trip_records
      where org_id = p_org_id and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
    ) x where gap_min is not null group by 1, 2
  ) m on m.vehicle_id = t.vehicle_id and m.d = t.d
  where t.gap_min is not null and m.cnt >= 3 and t.gap_min < m.med * 0.5
  on conflict (org_id, dedup_key) do nothing;

  -- (10) НЕПРЕРЫВНОЕ ВОЖДЕНИЕ: сессии рейсов водителя без перерыва ≥15 мин дольше 4 ч
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select p_org_id, 'continuous_driving', 'medium',
         jsonb_build_object('driver_id', s.driver_id, 'date', s.d,
                            'from', to_char(s.s_start at time zone 'Asia/Aqtobe', 'HH24:MI'),
                            'hours', round(extract(epoch from s.s_end - s.s_start) / 3600.0, 1)),
         'continuous_driving:' || s.driver_id::text || ':' || s.d::text || ':' ||
           to_char(s.s_start at time zone 'Asia/Aqtobe', 'HH24MI')
  from (
    select driver_id, d, grp, min(created_at) s_start, max(created_at) s_end
    from (
      select driver_id, created_at, d,
             sum(brk) over (partition by driver_id, d order by created_at) grp
      from (
        select driver_id, created_at, (created_at at time zone 'Asia/Aqtobe')::date d,
               case when created_at - lag(created_at) over
                 (partition by driver_id, (created_at at time zone 'Asia/Aqtobe')::date order by created_at)
                 >= interval '15 minutes' then 1 else 0 end brk
        from trip_records
        where org_id = p_org_id and (created_at at time zone 'Asia/Aqtobe')::date between p_from and p_to
      ) a
    ) b
    group by driver_id, d, grp
    having max(created_at) - min(created_at) > interval '4 hours'
  ) s
  on conflict (org_id, dedup_key) do nothing;

  select count(*) into v_after from anomalies where org_id = p_org_id;
  return (v_after - v_before)::int;
end;
$$;
