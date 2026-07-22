-- =============================================================================
-- QuarryOps · Миграция — журнал изменений (audit_log)
--
-- Универсальный AFTER-триггер пишет каждое создание/изменение/удаление значимых
-- записей: кто (auth.uid; null = система/импорт/cron), когда, какая таблица,
-- старые и новые значения, список изменённых полей. Читают только office/admin
-- своей организации; писать в лог нельзя никому (только definer-триггер).
-- =============================================================================

create table public.audit_log (
  id           bigint generated always as identity primary key,
  org_id       uuid,
  at           timestamptz not null default now(),
  user_id      uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  table_name   text not null,
  record_id    text,
  changed_cols text[],
  old_row      jsonb,
  new_row      jsonb
);

create index audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_user_idx on public.audit_log (user_id, at desc);

alter table public.audit_log enable row level security;
create policy "office read audit_log" on public.audit_log
  for select to authenticated
  using (org_id = public.current_org_id() and public.has_any_role(array['office', 'admin']));
-- insert/update/delete-политик нет: пишет только security definer триггер.

-- -----------------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb; v_new jsonb; v_cols text[]; v_org uuid; v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key) into v_cols
    from jsonb_each(v_new) n
    where v_old -> n.key is distinct from n.value;
    if v_cols is null then return null; end if; -- фактических изменений нет — не шумим
  end if;

  v_org := coalesce((v_new ->> 'org_id')::uuid, (v_old ->> 'org_id')::uuid);
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  insert into audit_log (org_id, user_id, action, table_name, record_id, changed_cols, old_row, new_row)
  values (v_org, auth.uid(), lower(tg_op), tg_table_name, v_id, v_cols, v_old, v_new);
  return null;
end;
$$;

-- Навеска на значимые таблицы (справочники, факты, договорной контур, статусы).
do $mig$
declare t text;
begin
  foreach t in array array[
    'fuel_issues', 'trip_records', 'shift_records', 'shift_journals',
    'trip_lineups', 'trip_lineup_vehicles',
    'vehicles', 'drivers', 'contractors', 'contracts', 'price_list',
    'contract_fuel_prices', 'penalties', 'routes', 'work_types', 'fuel_cards',
    'tankers', 'tanker_refills', 'tanker_measurements',
    'anomalies', 'org_settings', 'generated_documents', 'document_templates',
    'profiles'
  ] loop
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
      t, t
    );
  end loop;
end;
$mig$;
