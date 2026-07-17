-- =============================================================================
-- QuarryOps · Миграция 0003 — RLS-политики Фазы 1
-- Изоляция по org во ВСЕХ политиках. Операционные роли: fueler, checker, itr,
-- office, admin. Роль contractor (портал) — отдельной миграцией в Фазе 6
-- (добавление scoped-политик, не ретрофит org_id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Справочники: чтение — весь персонал; изменение — office/admin.
-- Одинаковое условие для 10 таблиц → цикл.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  ref_tables text[] := array[
    'contractors', 'contracts', 'price_list', 'contract_fuel_prices',
    'vehicles', 'drivers', 'fuel_cards', 'tankers', 'work_types', 'routes'
  ];
begin
  foreach t in array ref_tables loop
    execute format('alter table public.%I enable row level security;', t);

    execute format(
      $f$create policy "staff read %1$s" on public.%1$I
         for select to authenticated
         using (org_id = public.current_org_id()
                and public.has_any_role(array['fueler','checker','itr','office','admin']));$f$,
      t);

    execute format(
      $f$create policy "office manage %1$s" on public.%1$I
         for all to authenticated
         using (org_id = public.current_org_id()
                and public.has_any_role(array['office','admin']))
         with check (org_id = public.current_org_id()
                     and public.has_any_role(array['office','admin']));$f$,
      t);
  end loop;
end;
$$;

-- =============================================================================
-- ВЫДАЧИ ТОПЛИВА
-- =============================================================================
alter table public.fuel_issues enable row level security;

create policy "read fuel_issues (office/admin or own)"
  on public.fuel_issues for select to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or issued_by = auth.uid())
  );

create policy "fueler insert fuel_issues"
  on public.fuel_issues for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and public.has_any_role(array['fueler','admin'])
    and issued_by = auth.uid()
  );

-- =============================================================================
-- БЕНЗОВОЗ: ПРИХОД И ЗАМЕРЫ
-- =============================================================================
alter table public.tanker_refills enable row level security;

create policy "read tanker_refills (office/admin or own)"
  on public.tanker_refills for select to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or created_by = auth.uid())
  );

create policy "fueler insert tanker_refills"
  on public.tanker_refills for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and public.has_any_role(array['fueler','admin'])
    and created_by = auth.uid()
  );

alter table public.tanker_measurements enable row level security;

create policy "read tanker_measurements (office/admin or own)"
  on public.tanker_measurements for select to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or created_by = auth.uid())
  );

create policy "fueler insert tanker_measurements"
  on public.tanker_measurements for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and public.has_any_role(array['fueler','admin'])
    and created_by = auth.uid()
  );

-- =============================================================================
-- ТРАНЗАКЦИИ ПО КАРТАМ (управляет office/admin — импорт и разбор)
-- =============================================================================
alter table public.card_transactions enable row level security;

create policy "office manage card_transactions"
  on public.card_transactions for all to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['office','admin']))
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['office','admin']));

-- =============================================================================
-- ТАБЕЛЬ СМЕН
-- =============================================================================
alter table public.shift_records enable row level security;

create policy "read shift_records (office/admin or own)"
  on public.shift_records for select to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or itr_id = auth.uid())
  );

create policy "itr insert shift_records"
  on public.shift_records for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and public.has_any_role(array['itr','admin'])
    and itr_id = auth.uid()
  );

create policy "itr update own shift_records"
  on public.shift_records for update to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or itr_id = auth.uid())
  )
  with check (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or itr_id = auth.uid())
  );

-- =============================================================================
-- РЕЙСЫ
-- =============================================================================
alter table public.trip_records enable row level security;

create policy "read trip_records (office/admin or own)"
  on public.trip_records for select to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office','admin']) or recorded_by = auth.uid())
  );

create policy "checker insert trip_records"
  on public.trip_records for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and public.has_any_role(array['checker','admin'])
    and recorded_by = auth.uid()
  );

-- 5-минутное окно отмены собственной записи (быстрый undo в ленте).
create policy "own trip quick delete"
  on public.trip_records for delete to authenticated
  using (
    org_id = public.current_org_id()
    and recorded_by = auth.uid()
    and created_at > now() - interval '5 minutes'
  );

create policy "office delete trip_records"
  on public.trip_records for delete to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['office','admin']));

-- =============================================================================
-- ПРОСТОИ, ШТРАФЫ, ДОКУМЕНТЫ, АНОМАЛИИ — office/admin
-- =============================================================================
do $$
declare
  t text;
  office_tables text[] := array[
    'downtime_records', 'penalties', 'generated_documents', 'anomalies'
  ];
begin
  foreach t in array office_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      $f$create policy "office manage %1$s" on public.%1$I
         for all to authenticated
         using (org_id = public.current_org_id()
                and public.has_any_role(array['office','admin']))
         with check (org_id = public.current_org_id()
                     and public.has_any_role(array['office','admin']));$f$,
      t);
  end loop;
end;
$$;
