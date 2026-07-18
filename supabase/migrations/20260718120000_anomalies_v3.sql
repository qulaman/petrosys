-- =============================================================================
-- QuarryOps · Миграция 0018 — аномалии v3: агрегация «недопущенной техники»
--
-- Проблема: детектор unapproved_unit создавал аномалию на КАЖДУЮ смену
-- недопущенной машины (312 записей на 53 машины за июль) — список нечитаем.
-- v3: одна аномалия на машину×месяц с числом смен и диапазоном дат; пока
-- статус «new», счётчик обновляется при каждом прогоне.
--
-- Плюс: каждый детектор кладёт в entity_refs ключ 'date' (дата события) —
-- UI сортирует/фильтрует по дате события, а не по дате обнаружения.
-- Существующие записи дозаполняются, старые по-сменные «new» схлопываются.
-- =============================================================================

create or replace function public.detect_anomalies(p_org_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_before bigint; v_after bigint;
  v_month_start date := date_trunc('month', p_to)::date;
  v_gap numeric; v_nf_trips int; v_nf_hours int;
begin
  select count(*) into v_before from anomalies where org_id = p_org_id;
  select coalesce(tanker_gap_liters,20), coalesce(no_fuel_days_trips,2), coalesce(no_fuel_days_hours,3)
    into v_gap, v_nf_trips, v_nf_hours
    from org_settings where org_id = p_org_id;
  if v_gap is null then v_gap := 20; v_nf_trips := 2; v_nf_hours := 3; end if;

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
                            'date', (created_at at time zone 'Asia/Aqtobe')::date,
                            'diff', round(measured_liters - calculated_liters, 1),
                            'threshold', v_gap),
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

  -- (7) НЕДОПУЩЕННАЯ ТЕХНИКА — v3: одна аномалия на машину×месяц.
  -- Пока статус 'new', счётчик смен и диапазон дат обновляются при прогоне;
  -- разобранные (confirmed/dismissed/reviewed) не трогаем и не воскрешаем.
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select s.org_id, 'unapproved_unit', 'medium',
         jsonb_build_object('vehicle_id', s.vehicle_id,
                            'month', to_char(date_trunc('month', s.shift_date)::date, 'YYYY-MM'),
                            'date', min(s.shift_date), 'to', max(s.shift_date),
                            'shifts', count(*)),
         'unapproved_unit:' || s.vehicle_id::text || ':' || to_char(date_trunc('month', s.shift_date)::date, 'YYYY-MM')
  from shift_records s join vehicles v on v.id = s.vehicle_id
  where s.org_id = p_org_id and s.shift_date between p_from and p_to
    and (v.approved_from is null or s.shift_date < v.approved_from
         or (v.approved_to is not null and s.shift_date > v.approved_to))
  group by s.org_id, s.vehicle_id, date_trunc('month', s.shift_date)
  on conflict (org_id, dedup_key) do update
    set entity_refs = excluded.entity_refs
    where anomalies.status = 'new';

  -- (3) расход выше норматива (месяц)
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select v.org_id, 'over_norm', 'high',
         jsonb_build_object('vehicle_id', v.id, 'actual', round(l.liters / h.hours, 1),
                            'norm', v.fuel_norm_per_hour, 'month', to_char(v_month_start, 'YYYY-MM'),
                            'date', v_month_start),
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

  -- (2) РАБОТА БЕЗ ТОПЛИВА: работала ≥ N дней в окне N дней до p_to, заправок нет
  insert into anomalies (org_id, type, severity, entity_refs, dedup_key)
  select v.org_id, 'work_no_fuel', 'medium',
         jsonb_build_object('vehicle_id', v.id, 'days', n.days, 'to', p_to, 'date', p_to),
         'work_no_fuel:' || v.id::text || ':' || p_to::text
  from vehicles v
  cross join lateral (select case when v.accounting_type = 'trips' then v_nf_trips else v_nf_hours end as days) n
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

-- -----------------------------------------------------------------------------
-- Разовая чистка: схлопнуть по-сменные «недопущенная техника» (только new —
-- разобранные вручную остаются как есть) и дозаполнить дату события в старых.
-- -----------------------------------------------------------------------------
delete from public.anomalies
 where type = 'unapproved_unit' and status = 'new'
   and dedup_key like 'unapproved_unit:shift:%';

update public.anomalies
   set entity_refs = coalesce(entity_refs, '{}'::jsonb) || jsonb_build_object('date',
       coalesce(entity_refs->>'date',
                case when entity_refs ? 'month' then (entity_refs->>'month') || '-01' end,
                entity_refs->>'to',
                to_char(detected_at at time zone 'Asia/Aqtobe', 'YYYY-MM-DD')))
 where entity_refs is null or (entity_refs->>'date') is null;

-- Перепрогон за последний 31 день: агрегированные записи появляются сразу.
do $mig$
declare o record;
begin
  for o in select id from organizations loop
    perform public.detect_anomalies(o.id, (current_date - 31), current_date);
  end loop;
end;
$mig$;
