-- =============================================================================
-- QuarryOps · Миграция 0005 — org_id через колоночный DEFAULT current_org_id()
-- Заменяем BEFORE-триггеры set_org_id на DEFAULT: та же автопростановка org_id
-- для пользовательских вставок, но колонка становится необязательной в
-- сгенерированных TS-типах (Insert), и код инсертов чище.
-- Сиды/admin-клиент по-прежнему передают org_id явно (там auth.uid() = null).
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
    -- колоночный default
    execute format(
      'alter table public.%I alter column org_id set default public.current_org_id();', t);
    -- убрать теперь избыточный триггер
    execute format('drop trigger if exists set_org_id_%1$s on public.%1$s;', t);
  end loop;
end;
$$;

-- Функция set_org_id больше не нужна.
drop function if exists public.set_org_id();
